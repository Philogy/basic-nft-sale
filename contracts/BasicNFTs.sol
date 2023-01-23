// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.7;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract BasicNFTs is ERC721, Ownable, ReentrancyGuard {
    using ECDSA for bytes32;
    using SignatureChecker for address;
    using Strings for uint256;

    event Buy(address indexed buyer, bool indexed isPublic, uint256 amount);
    event VerifierSet(address indexed prevVerifier, address indexed newVerifier);
    event Withdraw(address indexed recipient, uint256 amount);

    struct SaleParams {
        uint64 start;
        uint64 end;
        uint64 userMaxBuys;
        uint64 totalMaxBuys;
    }

    struct Sale {
        SaleParams params;
        uint256 totalBuys;
        mapping(address => uint256) buys;
    }

    /// domain separators
    // keccak256("basic-nfts.access.is-whitelisted(address)")
    bytes32 internal constant DS_IS_WHITELISTED =
        0x29fac16e169dbd91dec98a06bd05b031d01e9b9f8301aa69dcfb3167e9ce478c;
    // keccak256("basic-nfts.access.captcha-solved(address)")
    bytes32 internal constant DS_CAPTCHA_SOLVED =
        0xe9d4ebff93fe7acf5db816c54861c27d4bfc2127bbec2077958592c789487223;

    Sale public whitelistedSale;
    Sale public publicSale;
    uint256 public totalBuys;
    uint256 public totalIssued;
    uint256 public immutable maxTotal;
    uint256 public immutable price;
    address public verifier;
    string public defaultURI;
    string public baseURI;

    constructor(
        string memory name_,
        string memory symbol_,
        SaleParams memory _whitelistedSaleParams,
        SaleParams memory _publicSaleParams,
        uint256 _maxTotal,
        uint256 _price,
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
        price = _price;
        verifier = _verifier;
        emit VerifierSet(address(0), _verifier);
        defaultURI = _defaultURI;
    }

    function setBaseURI(string memory _newBaseURI) external onlyOwner {
        baseURI = _newBaseURI;
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

    function doPublicBuy(bytes memory _captchaSig) external payable {
        _checkTime(publicSale.params);
        _verifyCaptcha(msg.sender, _captchaSig);
        uint256 bought = _buyForSale(publicSale);
        emit Buy(msg.sender, true, bought);
    }

    function tokenURI(uint256 _tokenId)
        public view override returns (string memory)
    {
        require(_exists(_tokenId), "BasicNFTs: nonexistent token");
        string memory baseURI_ = baseURI;
        if (bytes(baseURI_).length == 0) return defaultURI;
        return string(abi.encodePacked(baseURI_, _tokenId.toString()));
    }

    function getWhitelistBuys(address _buyer) external view returns (uint256) {
        return whitelistedSale.buys[_buyer];
    }

    function getPublicBuys(address _buyer) external view returns (uint256) {
        return publicSale.buys[_buyer];
    }

    function getConstants() external pure returns (bytes32, bytes32) {
        return (DS_IS_WHITELISTED, DS_CAPTCHA_SOLVED);
    }

    function _checkTime(SaleParams storage _params) internal view {
        uint256 timestamp = block.timestamp;
        require(timestamp >= _params.start, "BasicNFTs: before sale");
        require(timestamp <= _params.end, "BasicNFTs: after sale");
    }

    function _buyForSale(Sale storage _sale) internal returns (uint256 toBeBought) {
        toBeBought = msg.value / price;
        require(toBeBought >= 1, "BasicNFTs: must buy atleast 1");
        uint256 userTotalBuys = _sale.buys[msg.sender] + toBeBought;
        require(userTotalBuys <= _sale.params.userMaxBuys, "BasicNFTs: user buys maxed out");
        uint256 totalSaleBuys = _sale.totalBuys + toBeBought;
        require(
            totalSaleBuys <= _sale.params.totalMaxBuys,
            "BasicNFTs: sale sold out"
        );
        _mintMany(msg.sender, toBeBought);
        totalBuys += toBeBought;
        _sale.buys[msg.sender] = userTotalBuys;
        _sale.totalBuys = totalSaleBuys;
    }

    function _mintMany(address _recipient, uint256 _amount) internal nonReentrant {
        uint256 totalIssued_ = totalIssued;
        uint256 issued = totalIssued_ + _amount;
        require(issued <= maxTotal, "BasicNFTs: max issued");
        for (uint256 i; i < _amount; i++) {
            _safeMint(_recipient, totalIssued_ + i);
        }
        totalIssued = issued;
    }

    function _verifyWhitelist(address _account, bytes memory _whitelistedSig)
        internal view
    {
        require(
            _verifySig(DS_IS_WHITELISTED, _account, _whitelistedSig),
            "BasicNFTs: not whitelisted"
        );
    }

    function _verifyCaptcha(address _account, bytes memory _captchaSig)
        internal view
    {
        require(
            _verifySig(DS_CAPTCHA_SOLVED, _account, _captchaSig),
            "BasicNFTs: no captcha"
        );
    }

    function _verifySig(bytes32 _domainSep, address _account, bytes memory _sig)
        internal view returns (bool)
    {
        return verifier.isValidSignatureNow(
            keccak256(abi.encode(_domainSep, _account)).toEthSignedMessageHash(),
            _sig
        );
    }
}
