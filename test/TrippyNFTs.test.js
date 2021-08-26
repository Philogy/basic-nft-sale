const { accounts, contract, web3 } = require('@openzeppelin/test-environment')
const { trackBalance, ether, safeBN, stringifyBNObj, adjustSigV, ZERO } =
  require('./utils.js')(web3)
const { time, expectEvent, constants, expectRevert } = require('@openzeppelin/test-helpers')
const [admin, verifier, user1, user2, attacker] = accounts
const { expect } = require('chai')

const TrippyNFTs = contract.fromArtifact('TrippyNFTs')

describe('TrippyNFTs', () => {
  before(async () => {
    this.start = (await time.latest()).add(time.duration.hours(24))
    this.whitelistEnd = this.start.add(time.duration.hours(48))
    this.end = this.whitelistEnd.add(time.duration.hours(24))

    this.whitelistedSale = {
      price: ether(0.1),
      start: this.start,
      end: this.whitelistEnd,
      userMaxBuys: safeBN(2),
      totalMaxBuys: safeBN(3)
    }
    this.publicSale = {
      price: ether(0.05),
      start: this.whitelistEnd,
      end: this.end,
      userMaxBuys: safeBN(5),
      totalMaxBuys: safeBN(8)
    }
    this.maxTotal = safeBN(20)

    this.sale = await TrippyNFTs.new(
      'Trippy NFT collection',
      'TRP',
      stringifyBNObj(this.whitelistedSale),
      stringifyBNObj(this.publicSale),
      this.maxTotal,
      verifier,
      { from: admin }
    )
  })
  describe('initial parameters', () => {
    it('has correct domain separator constants', async () => {
      const res = await this.sale.getConstants()
      const keccak256 = (value) => web3.utils.soliditySha3({ type: 'string', value })
      this.sale.expectedConstants = {
        DS_IS_WHITELISTED: keccak256('trippy-nfts.access.is-whitelisted(address)'),
        DS_CAPTCHA_SOLVED: keccak256('trippy-nfts.access.captcha-solved(address)'),
        DS_VALID_METADATA: keccak256('trippy-nfts.verif.valid-metadata(uint256,string)')
      }
      expect(res[0]).to.equal(
        this.sale.expectedConstants.DS_IS_WHITELISTED,
        'DS_IS_WHITELISTED wrong'
      )
      expect(res[1]).to.equal(
        this.sale.expectedConstants.DS_CAPTCHA_SOLVED,
        'DS_CAPTCHA_SOLVED wrong'
      )
      expect(res[2]).to.equal(
        this.sale.expectedConstants.DS_VALID_METADATA,
        'DS_VALID_METADATA wrong'
      )
    })
    it('has correct initial owner', async () => {
      expect(await this.sale.owner()).to.equal(admin)
    })
    it('set correct initial verifier', async () => {
      expect(await this.sale.verifier()).to.equal(verifier)
      await expectEvent.inConstruction(this.sale, 'VerifierChanged', {
        prevVerifier: constants.ZERO_ADDRESS,
        newVerifier: verifier
      })
    })
    it('has correct initial parameters', async () => {
      const compareParams = (name, params, expectedParams) => {
        for (const [key, value] of Object.entries(expectedParams)) {
          expect(params[key]).to.be.bignumber.equal(value, `${name}.params.${key}`)
        }
      }

      expect(await this.sale.maxTotal()).to.be.bignumber.equal(this.maxTotal, 'maxTotal')
      const { params: whitelistSaleParams } = await this.sale.whitelistedSale()
      compareParams('whitelistedSale', whitelistSaleParams, this.whitelistedSale)
      const { params: publicSaleParams } = await this.sale.publicSale()
      compareParams('publicSale', publicSaleParams, this.publicSale)
    })
    it('starts users with no NFTs', async () => {
      expect(await this.sale.balanceOf(user1)).to.be.bignumber.equal(ZERO)
    })
  })
  describe('whitelist buy', () => {
    before(async () => {
      this.whitelistEncode = (account) => {
        const encoded = web3.eth.abi.encodeParameters(
          ['bytes32', 'address'],
          [this.sale.expectedConstants.DS_IS_WHITELISTED, account]
        )
        const hash = web3.utils.soliditySha3(encoded)
        return hash
      }
      this.whitelistBy = async (account, signer) => {
        const directSig = await web3.eth.sign(this.whitelistEncode(account), signer)
        return adjustSigV(directSig)
      }
    })
    it('disallows buy before start', async () => {
      expect(await time.latest()).to.be.bignumber.below(this.start)
      await expectRevert(this.sale.doWhitelistBuy('0x', { from: user1 }), 'TrippyNFTs: before sale')
    })
    it('disallows buy without valid sig', async () => {
      await time.increaseTo(this.start)
      await expectRevert(
        this.sale.doWhitelistBuy('0x', { from: attacker }),
        'TrippyNFTs: not whitelisted'
      )
      const fakeSig = await this.whitelistBy(attacker, attacker)
      await expectRevert(
        this.sale.doWhitelistBuy(fakeSig, { from: attacker }),
        'TrippyNFTs: not whitelisted'
      )
    })
    it('disallows different address sig reuse', async () => {
      this.user1Sig = await this.whitelistBy(user1, verifier)
      await expectRevert(
        this.sale.doWhitelistBuy(this.user1Sig, { from: attacker }),
        'TrippyNFTs: not whitelisted'
      )
    })
    it('disallows 0 token buys', async () => {
      const slightlyTooLittle = this.whitelistedSale.price.sub(safeBN('1'))
      await expectRevert(
        this.sale.doWhitelistBuy(this.user1Sig, { from: user1, value: slightlyTooLittle }),
        'TrippyNFTs: must buy atleast 1'
      )
    })
    it('disallow initial excess buys', async () => {
      const sale = this.whitelistedSale
      const total = sale.price.mul(sale.userMaxBuys.add(safeBN(1)))
      await expectRevert(
        this.sale.doWhitelistBuy(this.user1Sig, { from: user1, value: total }),
        'TrippyNFTs: user buys maxed out'
      )
    })
    it('allows valid buy', async () => {
      const sale = this.whitelistedSale
      const amount = safeBN(1)
      const total = sale.price.mul(amount)
      const receipt = await this.sale.doWhitelistBuy(this.user1Sig, { from: user1, value: total })
      expectEvent(receipt, 'Buy', { buyer: user1, isPublic: false, amount })
      expect(await this.sale.balanceOf(user1)).to.be.bignumber.equal(amount)
    })
    it('disallows excess buys', async () => {
      const sale = this.whitelistedSale
      const amount = safeBN(2)
      const total = sale.price.mul(amount)
      await expectRevert(
        this.sale.doWhitelistBuy(this.user1Sig, { from: user1, value: total }),
        'TrippyNFTs: user buys maxed out'
      )
      await this.sale.doWhitelistBuy(this.user1Sig, { from: user1, value: sale.price })
    })
    it('disallows exceeding sale max buys', async () => {
      this.user2Sig = await this.whitelistBy(user2, verifier)
      const sale = this.whitelistedSale
      const amount = safeBN(2)
      const total = sale.price.mul(amount)
      await expectRevert(
        this.sale.doWhitelistBuy(this.user2Sig, { from: user2, value: total }),
        'TrippyNFTs: sale sold out'
      )
    })
    it('disallows sale after end', async () => {
      await time.increaseTo(this.whitelistEnd.add(time.duration.seconds(1)))
      await expectRevert(
        this.sale.doWhitelistBuy(this.user2Sig, { from: user2 }),
        'TrippyNFTs: after sale'
      )
    })
  })
})
