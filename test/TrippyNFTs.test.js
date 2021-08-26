const { accounts, contract, web3 } = require('@openzeppelin/test-environment')
const { trackBalance, ether, safeBN, stringifyBNObj } = require('./utils.js')(web3)
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
      totalMaxBuys: safeBN(2000)
    }
    this.publicSale = {
      price: ether(0.05),
      start: this.whitelistEnd,
      end: this.end,
      userMaxBuys: safeBN(5),
      totalMaxBuys: safeBN(7000)
    }
    this.maxTotal = safeBN(10000)

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
  })
  describe('whitelist buy', () => {
    before(async () => {
      this.whitelistBy = async (account, signer) => {
        const encoded = web3.eth.abi.encodeParameters(
          ['bytes32', 'address'],
          [this.sale.expectedConstants.DS_IS_WHITELISTED, account]
        )
        return await web3.eth.sign(encoded, signer)
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
      const sig = await this.whitelistBy(user1, verifier)
      await expectRevert(
        this.sale.doWhitelistBuy(sig, { from: attacker }),
        'TrippyNFTs: not whitelisted'
      )
    })
    it('disallows 0 token buys', async () => {
      const sig = await this.whitelistBy(user1, verifier)
      const slightlyTooLittle = this.whitelistedSale.price.sub(safeBN('1'))
      await expectRevert(
        this.sale.doWhitelistBuy(sig, { from: user1, value: slightlyTooLittle }),
        'TrippyNFTs: must buy atleast 1'
      )
    })
  })
})
