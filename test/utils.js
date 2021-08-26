module.exports = (web3) => {
  const { BN } = require('bn.js')
  const { expect } = require('chai')
  const rlp = require('rlp')
  const keccak = require('keccak')

  const ZERO = new BN('0')
  const bnSum = (...nums) => nums.reduce((x, y) => x.add(y), ZERO)
  const encodeFunctionCall = (contract, method, args) => {
    return contract.contract.methods[method](...args).encodeABI()
  }
  const ether = (wei) => new BN(web3.utils.toWei(wei.toString()))
  const bnPerc = (num, perc) => num.mul(safeBN(perc)).div(new BN('100'))
  const getDetAddr = (addr, nonce) => {
    const rlpEncoded = rlp.encode([addr, nonce])
    const resHash = keccak('keccak256').update(rlpEncoded).digest('hex')

    const contractAddr = `0x${resHash.substring(24)}`
    return contractAddr
  }

  const getTxNonce = async (txId) => {
    const tx = await web3.eth.getTransaction(txId)
    return tx.nonce
  }

  class _BalanceTracker {
    constructor(token, address) {
      this.token = token
      this.address = address
      this.prev = ZERO
    }

    async _get() {
      if (this.token === null) return await web3.eth.getBalance(this.address)
      return await this.token.balanceOf(this.address)
    }

    async get(resetPrev = true) {
      const balance = await this._get()

      if (resetPrev) this.prev = balance
      return balance
    }

    async delta(resetPrev = true) {
      const balance = await this._get()

      const difference = balance.sub(this.prev)
      if (resetPrev) this.prev = balance

      return difference
    }

    async reset() {
      this.prev = await this._get()
    }
  }

  const trackBalance = async (token, address, setPrev = true) => {
    const balanceTracker = new _BalanceTracker(token, address)
    if (setPrev) balanceTracker.prev = await balanceTracker._get()
    return balanceTracker
  }

  const safeBN = (val) =>
    typeof val === 'number' ? new BN(Math.round(val).toString()) : new BN(val.toString())

  const bnE = (base, digits) => safeBN(base).mul(new BN('10').pow(safeBN(digits)))

  const expectEqualWithinPrecision = (a, b, digits = '0', errorMsg) => {
    expectEqualWithinError(a, b, bnE('1', digits), errorMsg)
  }

  const expectEqualWithinFraction = (a, b, numerator, denominator, errorMsg) => {
    const error = b.mul(numerator).div(denominator)
    expectEqualWithinError(a, b, error, errorMsg)
  }

  const expectEqualWithinError = (a, b, error, errorMsg) => {
    const diff = a.sub(b).abs()
    if (diff.gt(error)) {
      expect(a).to.be.bignumber.equal(b, errorMsg === undefined ? errorMsg : 'no error message')
    }
  }

  function solidityKeccak256(...args) {
    const types = []
    const values = []
    for (const { type, value } of args) {
      types.push(type)
      values.push(value)
    }
    return web3.utils.sha3(web3.eth.abi.encodeParameters(types, values))
  }

  function stringifyBNObj(obj) {
    const newObj = {}
    for (const [key, val] of Object.entries(obj)) {
      newObj[key] = BN.isBN(val) ? val.toString() : val
    }
    return newObj
  }

  const utils = {
    ZERO,
    bnSum,
    encodeFunctionCall,
    ether,
    bnPerc,
    getDetAddr,
    getTxNonce,
    trackBalance,
    expectEqualWithinPrecision,
    expectEqualWithinError,
    expectEqualWithinFraction,
    bnE,
    safeBN,
    solidityKeccak256,
    stringifyBNObj
  }

  return utils
}
