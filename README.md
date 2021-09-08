# Trippy NFT Sale Contract
Contract to track and limit sale of the Trippy NFT Collection.

## Documentation

### Types

* **`BN`**: Big Number object, may be a simple `String` or `Number` depending on
  the javascript ethereum library
* **`address`**: String in the format of an Ethereum address ("0x" + 40 hex characters)

### Public (view only) methods

* **`whitelistedSale()`**
  * Returns:

  ```javascript
  {
    params: {
      start: BN, // unix epoch in seconds at which the whitelist sale starts
      end: BN, // unix epoch in seconds at which the whitelist sale ends
      userMaxBuys: BN, // how many NFTs a whitelisted address may buy throughout the sale
      totalMaxBuys: BN, // how many NFTs are atmost allowed to be sold during the whitelist sale
    },
    totalbuys: BN // how many buys were already completed as part of the whitelist sale
  }

  ```

* **`publicSale()`**
  * Returns:

  (The returned values have the same structure and meaning as those returned
  from `whitelistedSale`)

  ```javascript
  {
    params: {
      start: BN, // unix epoch in seconds at which the public (captcha protected) sale starts
      end: BN, // unix epoch in seconds at which the public (captcha protected) sale ends
      userMaxBuys: BN, // how many NFTs a single captcha verified address may buy throughout the sale
      totalMaxBuys: BN, // how many NFTs are atmost allowed to be sold during the public sale
    },
    totalbuys: BN // how many buys were already completed as part of the public sale
  }

  ```

* **`totalBuys()`**
  * Returns: `BN` (How many NFTs have been bought in total, whitelist + public)

* **`totalIssued()`**
  * Returns: `BN` (How many NFTs have been issued in total, whitelist + public +
    direct owner allocation)

* **`maxTotal()`**
  * Returns: `BN` (The maximum amount of NFTs that may exist as part of the
    collection)

* **`price()`**
  * Returns: `BN` (The price per NFT in ETH that must be payed during both sales,
  denominated in Ether's base unit wei = `10^-18`)

* **`verifier()`**
  * Returns: `address` (address or public key of the authenticating private key)

* **`defaultURI()`**
  * Returns: `String` (default metadata URI for all NFTs prior to the base URI
    reveal)

* **`baseURI()`**
  * Returns: `String` (metadata URI prefix of tokens, empty if not yet revealed)

* **`owner()`**
  * Returns: `address` (current owner of contract)

* **`balanceOf(address)`**
  * Parameter(s):
    * `address _account`: account for which to query the amount of owned NFTs
  * Returns: `BN` (amount of owned NFTs, default: 0)

* **`ownerOf(uint256)`**
  * Parameter(s):
    * `uint256 _tokenId`: numerical ID of NFT
  * Returns: `address` (address of the account which currently owns the NFT,
    reverts if the NFT does not exist)

* **`tokenURI(uint256)`**
  * Parameter(s):
    * `uint256 _tokenId`: numerical ID of NFT
  * Returns: `String` (metadata URI of token, reverts if token doesn't exist)

* **`getWhitelistBuys(address)`**
  * Parameter(s):
    * `address _buyer`: address of buyer to query amount of buys for
  * Returns: `BN` (number of NFTs that the address has bought during the
    whitelist sale)

* **`getPublicBuys(address)`**
  * Parameter(s):
    * `address _buyer`: address of buyer to query amount of buys for
  * Returns: `BN` (number of NFTs that the address has bought during the
    public sale)

### Owner methods
This is the list of access restricted methods that can only be used by the
contract owner. All the methods listed here revert if the caller is not the
`owner` account.

* **`transferOwnership(address)`**
  * Parameter(s):
    * `address _newOwner`: address of account to become new owner
  * Emitted Event(s):
    * `OwnershipTransferred(previousOwner, newOwner)`

* **`setBaseURI(string)`**
  * Parameter(s):
    * `string memory _newBaseURI`: new metadata URI prefix to be stored in the
      contract, (stored in `baseURI`)

* **`setDefaultURI(string)`**
  * Parameter(s):
    * `string memory _defaultURI`: new default metadata URI to be stored in the
      contract, (stored in `defaultURI`)

* **`setVerifier(address)`**

  Useful for invalidating old signatures created by the previous verifier.

  * Parameter(s):
    * `address _newVerifier`: address to be set as the new verifier
  * Emitted Event(s):
    * `VerifierSet(verifier, newVerifier)`

* **`withdrawProceedsTo(address, uint256)`**
  * Paramter(s):
    * `address _recipient`: address of account to which to withdraw the
      specified amount of Ether
    * `uint256 _amount`: amount of Ether to withdraw. Will withdraw entire
      current balance if `_amount` = `0xfff...`
  * Emitted Event(s):
    * `Withdraw(recipient, amount)`

* **`allocateTo(_address, uint256)`**
  * Paramter(s):
    * `address _recipient`: address of account to receive allocated NFTs
    * `uint256 _amount`: amount of NFTs to mint
  * Emitted Event(s):
    * `Transfer(from, to, tokenId)` (from the zero address to the `_recipient`
      for every new NFT minted)

### Public (user facing) methods
These methods can be called by any user (under certain conditions). Unlike the
view-only methods calling these methods costs transaction fees as it modifies
the state of the smart contract.

* **`doWhitelistBuy(bytes) payable`**

  Reverts if the current block timestamp is not inbetween the `start` and `end`
  timestamps of the sale. The provided Ether along with the transaction should
  be a non-zero multiple of `price`. Any excess Ether is kept by the contract.

  * Paramter(s):
    * `bytes memory _whitelistSig`: byte encoded signature provided by the
      verifier confirming that the caller's address is on the whitelist
  * Emitted Event(s):
    * `Buy(buyer, isPublic, amount)` (emitted once, `amount` is equal to the
      amount of NFTs bought, `isPublic` is set to `false`)

* **`doPublicBuy(bytes) payable`**

  Reverts if the current block timestamp is not inbetween the `start` and `end`
  timestamps of the sale. The provided Ether along with the transaction should
  be a non-zero multiple of `price`. Any excess Ether is kept by the contract.

  * Paramter(s):
    * `bytes memory _captchaSig`: byte encoded signature provided by the
      verifier confirming that the caller has completed a captcha
  * Emitted Event(s):
    * `Buy(buyer, isPublic, amount)` (emitted once, `amount` is equal to the
      amount of NFTs bought, `isPublic` is set to `true`)

* **`safeTransferFrom(address, address, uint256)`**

  Transfers a single NFT to another address. Will revert if the caller is not
  either the owner of the NFT or approved by the owner.

  * Paramter(s):
    * `address _from`: address of the account which owns the NFT.
    * `address _to`: destination address
    * `uint256 _tokenId`: numerical ID of the NFT to be transferred
  * Emitted Event(s):
    * `Transfer(from, to, tokenId)`

    (Potential emits an additional Approval event)
