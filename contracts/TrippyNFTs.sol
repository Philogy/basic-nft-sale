// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.7;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract TrippyNFTs is ERC721URIStorage, Ownable, ReentrancyGuard {
    using ECDSA for bytes32;
    using SignatureChecker for address;

    event Buy(address indexed buyer, bool indexed isPublic, uint256 amount);
    event VerifierSet(address indexed prevVerifier, address indexed newVerifier);
    event Withdraw(address indexed recipient, uint256 amount);

    struct SaleParams {
        uint64 price;
        uint32 start;
        uint32 end;
        uint64 userMaxBuys;
        uint64 totalMaxBuys;
    }

    struct Sale {
        SaleParams params;
        uint256 totalBuys;
        mapping(address => uint256) buys;
    }

    /// domain separators
    // keccak256("trippy-nfts.access.is-whitelisted(address)")
    bytes32 internal constant DS_IS_WHITELISTED =
        0xc6570f378e38907781b14e02a9e9c55342ebe951a8bb72ea05e25cc035c728c6;
    // keccak256("trippy-nfts.access.is-vip-buyer(address,uint256,uint256)")
    bytes32 internal constant DS_IS_VIP_BUYER =
        0xd56a2babab7800d0a1b3acae582dce8dcee41b7d898ebed1f600fa902988b48d;
    // keccak256("trippy-nfts.access.captcha-solved(address)")
    bytes32 internal constant DS_CAPTCHA_SOLVED =
        0xbdb1174521f3a1bc58650f9b7f1d334ba5a5d285784105f22a08b6f5a9600656;
    // keccak256("trippy-nfts.verif.valid-metadata(uint256,string)")
    bytes32 internal constant DS_VALID_METADATA =
        0x7f0194f46a516c4bd3380098cb2274989108caa7eb882bf30e7d9807f42d7003;

    Sale public whitelistedSale;
    Sale public publicSale;
    uint256 public totalBuys;
    uint256 public totalIssued;
    uint256 public immutable maxTotal;
    address public verifier;
    string public defaultURI;
    mapping(uint256 => address) public tokenURISetter;

    constructor(
        string memory name_,
        string memory symbol_,
        SaleParams memory _whitelistedSaleParams,
        SaleParams memory _publicSaleParams,
        uint256 _maxTotal,
        address _verifier,
        string memory _defaultURI
    )
        ERC721(name_, symbol_)
        Ownable()
        ReentrancyGuard()
    {
        whitelistedSale.params = _whitelistedSaleParams;
        publicSale.params = _publicSaleParams;
        maxTotal = _maxTotal;
        verifier = _verifier;
        emit VerifierSet(address(0), _verifier);
        defaultURI = _defaultURI;
    }

    function setVerifier(address _newVerifier) external onlyOwner {
        emit VerifierSet(verifier, _newVerifier);
        verifier = _newVerifier;
    }

    function withdrawProceedsTo(address payable _recipient, uint256 _amount)
        external onlyOwner
    {
        if (_amount == type(uint256).max) {
            _amount = address(this).balance;
        }
        _recipient.transfer(_amount);
        emit Withdraw(_recipient, _amount);
    }

    function allocateTo(address _recipient, uint256 _amount) external onlyOwner {
        _mintMany(_recipient, _amount);
    }

    function setDefaultURI(string memory _defaulURI) external onlyOwner {
        defaultURI = _defaulURI;
    }

    function doWhitelistBuy(bytes memory _whitelistedSig) external payable {
        _checkTime(whitelistedSale.params);
        _verifyWhitelist(msg.sender, _whitelistedSig);
        uint256 bought = _buyForSale(whitelistedSale);
        emit Buy(msg.sender, false, bought);
    }

    function doVipBuy(uint256 _userMaxBuys, uint256 _price, bytes memory _vipBuySig)
        external payable
    {
        _checkTime(whitelistedSale.params);
        require(
            _verifySig(
                abi.encode(DS_IS_VIP_BUYER, msg.sender, _userMaxBuys, _price),
                _vipBuySig
            ),
            "TrippyNFTs: unverified VIP"
        );
        uint256 bought = _buy(whitelistedSale, _price, _userMaxBuys);
        emit Buy(msg.sender, false, bought);
    }

    function doPublicBuy(bytes memory _captchaSig) external payable {
        _checkTime(publicSale.params);
        _verifyCaptcha(msg.sender, _captchaSig);
        uint256 bought = _buyForSale(publicSale);
        emit Buy(msg.sender, true, bought);
    }

    function revealMetadata(
        uint256[] memory _tokenIds,
        string[] memory _tokenURIs,
        bytes memory _validMetadataSig
    )
        external
    {
        uint256 tokens = _tokenIds.length;
        require(tokens == _tokenURIs.length, "TrippyNFTs: length mismatch");
        require(
            _verifySig(
                abi.encode(DS_VALID_METADATA, _tokenIds, _tokenURIs),
                _validMetadataSig
            ),
            "TrippyNFTs: unverified metadata"
        );
        for (uint256 i; i < tokens; i++) {
            _setTokenURI(_tokenIds[i], _tokenURIs[i]);
        }
    }

    function tokenURI(uint256 _tokenId)
        public view override returns (string memory)
    {
        string memory tokenURI_ = super.tokenURI(_tokenId);
        return bytes(tokenURI_).length != 0 ? tokenURI_ : defaultURI;
    }

    function getWhitelistBuys(address _buyer) external view returns (uint256) {
        return whitelistedSale.buys[_buyer];
    }

    function getPublicBuys(address _buyer) external view returns (uint256) {
        return publicSale.buys[_buyer];
    }

    function getConstants() external pure returns (bytes32, bytes32, bytes32) {
        return (DS_IS_WHITELISTED, DS_CAPTCHA_SOLVED, DS_VALID_METADATA);
    }

    function _checkTime(SaleParams storage _params) internal view {
        uint256 timestamp = block.timestamp;
        require(timestamp >= _params.start, "TrippyNFTs: before sale");
        require(timestamp <= _params.end, "TrippyNFTs: after sale");
    }

    function _buyForSale(Sale storage _sale) internal returns (uint256 toBeBought) {
        toBeBought = _buy(_sale, _sale.params.price, _sale.params.userMaxBuys);
    }

    function _buy(Sale storage _sale, uint256 _price, uint256 _userMaxBuys)
        internal returns (uint256 toBeBought)
    {
        toBeBought = msg.value / _price;
        require(toBeBought >= 1, "TrippyNFTs: must buy atleast 1");
        uint256 userTotalBuys = _sale.buys[msg.sender] + toBeBought;
        require(userTotalBuys <= _userMaxBuys, "TrippyNFTs: user buys maxed out");
        uint256 totalSaleBuys = _sale.totalBuys + toBeBought;
        require(
            totalSaleBuys <= _sale.params.totalMaxBuys,
            "TrippyNFTs: sale sold out"
        );
        _mintMany(msg.sender, toBeBought);
        totalBuys += toBeBought;
        _sale.buys[msg.sender] = userTotalBuys;
        _sale.totalBuys = totalSaleBuys;
    }

    function _mintMany(address _recipient, uint256 _amount) internal nonReentrant {
        uint256 totalIssued_ = totalIssued;
        uint256 issued = totalIssued_ + _amount;
        require(issued <= maxTotal, "TrippyNFTs: max issued");
        for (uint256 i; i < _amount; i++) {
            _safeMint(_recipient, totalIssued_ + i);
        }
        totalIssued = issued;
    }

    function _verifyWhitelist(address _account, bytes memory _whitelistedSig)
        internal view
    {
        require(
            _verifySig(abi.encode(DS_IS_WHITELISTED, _account), _whitelistedSig),
            "TrippyNFTs: not whitelisted"
        );
    }

    function _verifyCaptcha(address _account, bytes memory _captchaSig)
        internal view
    {
        require(
            _verifySig(abi.encode(DS_CAPTCHA_SOLVED, _account), _captchaSig),
            "TrippyNFTs: no captcha"
        );
    }

    function _verifySig(bytes memory _data, bytes memory _sig)
        internal view returns (bool)
    {
        return verifier.isValidSignatureNow(
            keccak256(_data).toEthSignedMessageHash(),
            _sig
        );
    }

    function _setTokenURI(uint256 _tokenId, string memory _tokenURI)
        internal override
    {
        require(tokenURISetter[_tokenId] != verifier, "TrippyNFTs: URI already set");
        super._setTokenURI(_tokenId, _tokenURI);
        tokenURISetter[_tokenId] = verifier;
    }
}
