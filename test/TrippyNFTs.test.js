const { accounts, contract, web3 } = require('@openzeppelin/test-environment')
const { trackBalance, ether, safeBN, stringifyBNObj, adjustSigV, ZERO, ONE } =
  require('./utils.js')(web3)
const { time, expectEvent, constants, expectRevert } = require('@openzeppelin/test-helpers')
const [admin1, admin2, verifier1, verifier2, user1, user2, attacker] = accounts
const { expect } = require('chai')

const TrippyNFTs = contract.fromArtifact('TrippyNFTs')

describe('TrippyNFTs', () => {
  before(async () => {
    this.start = (await time.latest()).add(time.duration.hours(24))
    this.whitelistEnd = this.start.add(time.duration.hours(48))
    this.publicStart = this.whitelistEnd.add(time.duration.hours(24))
    this.end = this.publicStart.add(time.duration.hours(24))

    this.whitelistedSale = {
      start: this.start,
      end: this.whitelistEnd,
      userMaxBuys: safeBN(2),
      totalMaxBuys: safeBN(3)
    }
    this.publicSale = {
      start: this.publicStart,
      end: this.end,
      userMaxBuys: safeBN(5),
      totalMaxBuys: safeBN(8)
    }
    this.maxTotal = safeBN(20)
    this.defaultURI = 'placeholder-default-uri'

    this.price = ether(0.1)

    this.sale = await TrippyNFTs.new(
      'Trippy NFT collection',
      'TRP',
      stringifyBNObj(this.whitelistedSale),
      stringifyBNObj(this.publicSale),
      this.maxTotal,
      this.price,
      verifier1,
      this.defaultURI,
      { from: admin1 }
    )
  })
  describe('initial parameters', () => {
    it('has correct domain separator constants', async () => {
      const constants = await this.sale.getConstants()
      const keccak256 = (value) => web3.utils.soliditySha3({ type: 'string', value })
      this.sale.expectedConstants = {
        DS_IS_WHITELISTED: keccak256('trippy-nfts.access.is-whitelisted(address)'),
        DS_CAPTCHA_SOLVED: keccak256('trippy-nfts.access.captcha-solved(address)')
      }
      expect(constants[0]).to.equal(
        this.sale.expectedConstants.DS_IS_WHITELISTED,
        'DS_IS_WHITELISTED wrong'
      )
      expect(constants[1]).to.equal(
        this.sale.expectedConstants.DS_CAPTCHA_SOLVED,
        'DS_CAPTCHA_SOLVED wrong'
      )
    })
    it('has correct initial owner', async () => {
      expect(await this.sale.owner()).to.equal(admin1)
    })
    it('set correct initial verifier', async () => {
      expect(await this.sale.verifier()).to.equal(verifier1)
      await expectEvent.inConstruction(this.sale, 'VerifierSet', {
        prevVerifier: constants.ZERO_ADDRESS,
        newVerifier: verifier1
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
    it('starts with no tokenURI setter', async () => {
      expect(await this.sale.tokenURISetter(ZERO)).to.equal(constants.ZERO_ADDRESS)
    })
    it('starts with correct default URI', async () => {
      expect(await this.sale.defaultURI()).to.equal(this.defaultURI)
    })
  })
  describe('whitelisted sale', () => {
    before(async () => {
      const whitelistEncode = (account) => {
        const encoded = web3.eth.abi.encodeParameters(
          ['bytes32', 'address'],
          [this.sale.expectedConstants.DS_IS_WHITELISTED, account]
        )
        const hash = web3.utils.soliditySha3(encoded)
        return hash
      }
      this.whitelistBy = async (account, signer) => {
        const directSig = await web3.eth.sign(whitelistEncode(account), signer)
        return adjustSigV(directSig)
      }
    })
    it('disallows buy before start', async () => {
      expect(await time.latest()).to.be.bignumber.below(this.start)
      await expectRevert(this.sale.doWhitelistBuy('0x', { from: user1 }), 'TrippyNFTs: before sale')
    })
    it('disallows buy without valid signature', async () => {
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
      this.user1Sig = await this.whitelistBy(user1, verifier1)
      await expectRevert(
        this.sale.doWhitelistBuy(this.user1Sig, { from: attacker }),
        'TrippyNFTs: not whitelisted'
      )
    })
    it('disallows 0 token buys', async () => {
      const slightlyTooLittle = this.price.sub(safeBN('1'))
      await expectRevert(
        this.sale.doWhitelistBuy(this.user1Sig, { from: user1, value: slightlyTooLittle }),
        'TrippyNFTs: must buy atleast 1'
      )
    })
    it('disallow initial excess buys', async () => {
      const sale = this.whitelistedSale
      const total = this.price.mul(sale.userMaxBuys.add(ONE))
      await expectRevert(
        this.sale.doWhitelistBuy(this.user1Sig, { from: user1, value: total }),
        'TrippyNFTs: user buys maxed out'
      )
    })
    it('allows valid buy', async () => {
      const amount = ONE
      const total = this.price.mul(amount)
      const receipt = await this.sale.doWhitelistBuy(this.user1Sig, { from: user1, value: total })
      expectEvent(receipt, 'Buy', { buyer: user1, isPublic: false, amount })
      expect(await this.sale.balanceOf(user1)).to.be.bignumber.equal(amount)
      expect(await this.sale.getWhitelistBuys(user1)).to.be.bignumber.equal(amount)
      const data = await this.sale.whitelistedSale()
      expect(data.totalBuys).to.be.bignumber.equal(ONE)
    })
    it('disallows excess buys', async () => {
      const amount = safeBN(2)
      const total = this.price.mul(amount)
      await expectRevert(
        this.sale.doWhitelistBuy(this.user1Sig, { from: user1, value: total }),
        'TrippyNFTs: user buys maxed out'
      )
      await this.sale.doWhitelistBuy(this.user1Sig, { from: user1, value: this.price })
    })
    it('disallows exceeding sale max buys', async () => {
      this.user2Sig = await this.whitelistBy(user2, verifier1)
      const amount = safeBN(2)
      const total = this.price.mul(amount)
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
  describe('public sale', () => {
    before(async () => {
      const captchaEncode = (account) => {
        const encoded = web3.eth.abi.encodeParameters(
          ['bytes32', 'address'],
          [this.sale.expectedConstants.DS_CAPTCHA_SOLVED, account]
        )
        const hash = web3.utils.soliditySha3(encoded)
        return hash
      }
      this.validateCaptcha = async (account, signer) => {
        const directSig = await web3.eth.sign(captchaEncode(account), signer)
        return adjustSigV(directSig)
      }
    })
    it('disallow buy before start', async () => {
      await expectRevert(this.sale.doPublicBuy('0x', { from: user1 }), 'TrippyNFTs: before sale')
    })
    it('disallows buy without valid signature', async () => {
      await time.increaseTo(this.publicStart)
      await expectRevert(this.sale.doPublicBuy('0x', { from: user1 }), 'TrippyNFTs: no captcha')
      const sig = await this.validateCaptcha(attacker, attacker)
      await expectRevert(this.sale.doPublicBuy(sig, { from: attacker }), 'TrippyNFTs: no captcha')
    })
    it('disallows whitelist sig', async () => {
      const altSig = await this.whitelistBy(attacker, verifier1)
      await expectRevert(
        this.sale.doPublicBuy(altSig, { from: attacker }),
        'TrippyNFTs: no captcha'
      )
    })
    it('disallows 0 public buys', async () => {
      this.user2Sig = await this.validateCaptcha(user2, verifier1)
      await expectRevert(
        this.sale.doPublicBuy(this.user2Sig, { from: user2 }),
        'TrippyNFTs: must buy atleast 1'
      )
      await expectRevert(
        this.sale.doPublicBuy(this.user2Sig, {
          from: user2,
          value: this.price.sub(ONE)
        }),
        'TrippyNFTs: must buy atleast 1'
      )
    })
    it('disallows excess buys', async () => {
      this.doPublicBuy = (buyer, sig, amount) =>
        this.sale.doPublicBuy(sig, { from: buyer, value: this.price.mul(amount) })
      const overMaxUserBuys = this.publicSale.userMaxBuys.add(ONE)
      await expectRevert(
        this.doPublicBuy(user2, this.user2Sig, overMaxUserBuys),
        'TrippyNFTs: user buys maxed out'
      )
      this.initialPublicBuys = safeBN(2)
      await this.doPublicBuy(user2, this.user2Sig, this.initialPublicBuys)
      await expectRevert(
        this.doPublicBuy(user2, this.user2Sig, overMaxUserBuys.sub(this.initialPublicBuys)),
        'TrippyNFTs: user buys maxed out'
      )
    })
    it('allows normal buys', async () => {
      this.user1Sig = await this.validateCaptcha(user1, verifier1)
      const buyAmount = safeBN(2)
      const receipt = await this.doPublicBuy(user1, this.user1Sig, buyAmount)
      expectEvent(receipt, 'Buy', {
        buyer: user1,
        isPublic: true,
        amount: buyAmount
      })
      expect(await this.sale.getPublicBuys(user1)).to.be.bignumber.equal(buyAmount)
      const data = await this.sale.publicSale()
      expect(data.totalBuys).to.be.bignumber.equal(buyAmount.add(this.initialPublicBuys))
    })
    it('disallows buys exceeding total max', async () => {
      const maxBuys = this.publicSale.userMaxBuys
      const toMaxBuys1 = maxBuys.sub(await this.sale.getPublicBuys(user1))
      await this.doPublicBuy(user1, this.user1Sig, toMaxBuys1)
      const toMaxBuys2 = maxBuys.sub(this.initialPublicBuys)
      await expectRevert(
        this.doPublicBuy(user2, this.user2Sig, toMaxBuys2),
        'TrippyNFTs: sale sold out'
      )
    })
    it('disallows buys once sold out', async () => {
      const data = await this.sale.publicSale()
      const maxRemainingBuys = this.publicSale.totalMaxBuys.sub(data.totalBuys)
      await this.doPublicBuy(user2, this.user2Sig, maxRemainingBuys)
      const sig = await this.validateCaptcha(attacker, verifier1)
      await expectRevert(this.doPublicBuy(attacker, sig, ONE), 'TrippyNFTs: sale sold out')
    })
    it('disallow buys after end', async () => {
      await time.increaseTo(this.publicSale.end.add(time.duration.seconds(1)))
      await expectRevert(this.doPublicBuy(user1, this.user1Sig, ONE), 'TrippyNFTs: after sale')
    })
    it('has correct total buys and total issued after sales', async () => {
      const totalBuys = await this.sale.totalBuys()
      const totalIssued = await this.sale.totalIssued()
      expect(totalBuys).to.be.bignumber.equal(totalIssued)
      expect(totalBuys).to.be.bignumber.equal(
        this.whitelistedSale.userMaxBuys.add(this.publicSale.totalMaxBuys)
      )
    })
  })
  describe('owner functionality', () => {
    it('only allows owner to withdraw proceeds', async () => {
      const sellerBalance = safeBN(await web3.eth.getBalance(this.sale.address))
      const balTracker = await trackBalance(null, admin2)
      await expectRevert(
        this.sale.withdrawProceedsTo(attacker, sellerBalance, { from: attacker }),
        'Ownable: caller is not the owner'
      )
      const withdrawAmount = sellerBalance.div(safeBN(3))
      const receipt = await this.sale.withdrawProceedsTo(admin2, withdrawAmount, { from: admin1 })
      expectEvent(receipt, 'Withdraw', { recipient: admin2, amount: withdrawAmount })
      expect(await balTracker.delta()).to.be.bignumber.equal(withdrawAmount)
    })
    it('disallows withdrawing more than total balance', async () => {
      const sellerBalance = safeBN(await web3.eth.getBalance(this.sale.address))
      const withdrawAmount = sellerBalance.add(ONE)
      await expectRevert.unspecified(
        this.sale.withdrawProceedsTo(admin2, withdrawAmount, { from: admin1 })
      )
    })
    it('allows automatically withdrawing max', async () => {
      const sellerBalance = safeBN(await web3.eth.getBalance(this.sale.address))
      const balTracker = await trackBalance(null, admin2)
      const receipt = await this.sale.withdrawProceedsTo(admin2, constants.MAX_UINT256, {
        from: admin1
      })
      expectEvent(receipt, 'Withdraw', { recipient: admin2, amount: sellerBalance })
      expect(await balTracker.delta()).to.be.bignumber.equal(sellerBalance)
    })
    it('only allows owner to change verifier', async () => {
      await expectRevert(
        this.sale.setVerifier(attacker, { from: attacker }),
        'Ownable: caller is not the owner'
      )

      const receipt = await this.sale.setVerifier(verifier2, { from: admin1 })
      expectEvent(receipt, 'VerifierSet', {
        prevVerifier: verifier1,
        newVerifier: verifier2
      })
      expect(await this.sale.verifier()).to.equal(verifier2)
    })
    it('only allows owner to change owner', async () => {
      await expectRevert(
        this.sale.transferOwnership(attacker, { from: attacker }),
        'Ownable: caller is not the owner'
      )
      await this.sale.transferOwnership(admin2, { from: admin1 })
      expect(await this.sale.owner()).to.equal(admin2)
      await this.sale.transferOwnership(admin1, { from: admin2 })
      expect(await this.sale.owner()).to.equal(admin1)
    })
    it('only allows owner to change default URI', async () => {
      const newDefaultURI = 'other-default-uri'
      await expectRevert(
        this.sale.setDefaultURI('bad-uri', { from: attacker }),
        'Ownable: caller is not the owner'
      )
      await this.sale.setDefaultURI(newDefaultURI, { from: admin1 })
      expect(await this.sale.defaultURI()).to.equal(newDefaultURI)
      this.defaultURI = newDefaultURI
    })
    it('only allows owner to set base URI', async () => {
      const newBaseURI = 'ipfs://some-ipfs-CID/'
      await expectRevert(
        this.sale.setBaseURI('bad-uri', { from: attacker }),
        'Ownable: caller is not the owner'
      )
      expect(await this.sale.baseURI()).to.equal('')
      await this.sale.setBaseURI(newBaseURI, { from: admin1 })
      expect(await this.sale.baseURI()).to.equal(newBaseURI)

      await this.sale.setBaseURI('', { from: admin1 })
    })
    it('only allows owner to freely mint tokens', async () => {
      await expectRevert(
        this.sale.allocateTo(attacker, safeBN(5), { from: attacker }),
        'Ownable: caller is not the owner'
      )
      expect(await this.sale.balanceOf(admin2)).to.be.bignumber.equal(ZERO)
      const totalBuysBefore = await this.sale.totalBuys()
      const totalIssuedBefore = await this.sale.totalIssued()

      const toBeAllocated = safeBN(5)
      await this.sale.allocateTo(admin2, toBeAllocated, { from: admin1 })

      expect(await this.sale.balanceOf(admin2)).to.be.bignumber.equal(toBeAllocated)
      const totalBuysAfter = await this.sale.totalBuys()
      expect(totalBuysAfter).to.be.bignumber.equal(totalBuysBefore)
      const totalIssuedAfter = await this.sale.totalIssued()
      expect(totalIssuedBefore.add(toBeAllocated)).to.be.bignumber.equal(totalIssuedAfter)
    })
    it('prevents allocation beyond max total', async () => {
      const maxRemainingAllocation = (await this.sale.maxTotal()).sub(await this.sale.totalIssued())
      await expectRevert(
        this.sale.allocateTo(attacker, maxRemainingAllocation.add(ONE), { from: admin1 }),
        'TrippyNFTs: max issued'
      )
    })
  })
  describe('token URIs', () => {
    it('only returns defaultURI for existing tokens', async () => {
      expect(await this.sale.baseURI()).to.equal('')
      await expectRevert(this.sale.tokenURI(safeBN(999)), 'TrippyNFTs: nonexistent token')
      expect(await this.sale.tokenURI(safeBN(0))).to.equal(this.defaultURI)
    })
    it('returns concatenated URI once base URI is set', async () => {
      const newBaseURI = 'ipfs://some-ipfs-folder-root-cid/'
      await this.sale.setBaseURI(newBaseURI, { from: admin1 })
      const tokenId = 0
      expect(await this.sale.tokenURI(safeBN(tokenId))).to.equal(`${newBaseURI}${tokenId}`)
    })
    it('still reverts for nonexistent tokens', async () => {
      expect(await this.sale.baseURI()).to.not.equal('')
      await expectRevert(this.sale.tokenURI(safeBN(999)), 'TrippyNFTs: nonexistent token')
    })
  })
  describe('gas usage', () => {
    const formatter = Intl.NumberFormat('en-us', { maximumFractionDigits: 3 })
    const formatGas = (receipt) => {
      const gasUsed = receipt?.gasUsed ?? receipt.receipt.gasUsed
      return formatter.format(gasUsed)
    }
    it('deployment', async () => {
      this.start = (await time.latest()).add(time.duration.hours(24))
      this.whitelistEnd = this.start.add(time.duration.hours(48))
      this.publicStart = this.whitelistEnd.add(time.duration.hours(24))
      this.end = this.publicStart.add(time.duration.hours(24))

      this.whitelistedSale = {
        start: this.start,
        end: this.whitelistEnd,
        userMaxBuys: safeBN(2),
        totalMaxBuys: safeBN(3)
      }
      this.publicSale = {
        start: this.publicStart,
        end: this.end,
        userMaxBuys: safeBN(5),
        totalMaxBuys: safeBN(8)
      }
      this.maxTotal = safeBN(20)
      this.defaultURI = 'placeholder-default-uri'

      this.sale = await TrippyNFTs.new(
        'Trippy NFT collection',
        'TRP',
        stringifyBNObj(this.whitelistedSale),
        stringifyBNObj(this.publicSale),
        this.maxTotal,
        ether(0.1),
        verifier1,
        this.defaultURI,
        { from: admin1 }
      )
      const tx = this.sale.transactionHash
      const receipt = await web3.eth.getTransactionReceipt(tx)
      console.log(`deployment cost: ${formatGas(receipt)}`)
    })
    it('changing verifier', async () => {
      const receipt = await this.sale.setVerifier(verifier2, { from: admin1 })
      console.log(`changing verifier cost: ${formatGas(receipt)}`)
    })
  })
})
