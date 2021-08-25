// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.7;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract TrippyNFTs is ERC721URIStorage, Ownable {
    using SignatureChecker for address;

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
    // keccak256("trippy-nfts.access.captcha-solved(address)")
    bytes32 internal constant DS_CAPTCHA_SOLVED =
        0xbdb1174521f3a1bc58650f9b7f1d334ba5a5d285784105f22a08b6f5a9600656;
    // keccak256("trippy-nfts.verif.valid-metadata(uint256,string")
    bytes32 internal constant DS_VALID_METADATA =
        0x7f0194f46a516c4bd3380098cb2274989108caa7eb882bf30e7d9807f42d7003;

    Sale public whitelistedSale;
    Sale public publicSale;
    uint256 public totalBuys;
    uint256 public totalIssued;
    uint256 public immutable maxTotal;

    address internal verifier;

    constructor(
        string memory name_,
        string memory symbol_,
        SaleParams memory _whitelistedSaleParams,
        uint256 _maxTotal,
        address _verifier
    )
        ERC721(name_, symbol_)
        Ownable()
    {
        whitelistedSale.params = _whitelistedSaleParams;
        maxTotal = _maxTotal;
        verifier = _verifier;
    }

    function setVerifier(address _newVerifier) external onlyOwner {
        verifier = _newVerifier;
    }

    function withdrawProceedsTo(address payable _recipient, uint256 _amount)
        external onlyOwner
    {
        _recipient.transfer(_amount);
    }

    function allocate(address _recipient, uint256 _amount) external onlyOwner {
        _mintMany(_recipient, _amount);
    }

    function doWhitelistBuy(bytes memory _whitelistedSig) external payable {
        _checkTime(whitelistedSale.params);
        _verifyWhitelist(msg.sender, _whitelistedSig);
        uint256 toBeBought = msg.value / uint256(whitelistedSale.params.price);
        require(toBeBought >= 1, "TrippyNFTs: must buy atleast 1");
        uint256 userTotalBuys = whitelistedSale.buys[msg.sender] + toBeBought;
        require(
            userTotalBuys <= whitelistedSale.params.userMaxBuys,
            "TrippyNFTs: buys maxed out"
        );
        uint256 totalBuys = whitelistedSale.totalBuys + toBeBought;
        require(
            totalBuys <= whitelistedSale.params.totalMaxBuys,
            "TrippyNFTs: whitelisted sold out"
        );
        _mintMany(msg.sender, toBeBought);
        totalBuys += toBeBought;
        whitelistedSale.buys[msg.sender] = userTotalBuys;
        whitelistedSale.totalBuys = totalBuys;
    }

    function _mintMany(address _recipient, uint256 _amount) internal {
        uint256 totalIssued_ = totalIssued;
        uint256 issued = totalIssued_ + _amount;
        require(issued <= maxTotal, "TrippyNFTs: max issued");
        for (uint256 i; i < _amount; i++) {
            _safeMint(_recipient, totalIssued_ + i);
        }
        totalIssued = issued;
    }

    function _checkTime(SaleParams storage _params) internal {
        uint256 timestamp = block.timestamp;
        require(timestamp >= _params.start, "TrippyNFTs: before sale");
        require(timestamp <= _params.end, "TrippyNFTs: after sale");
    }

    function _verifyWhitelist(address _account, bytes memory _whitelistedSig)
        internal
    {
        require(
            verifier.isValidSignatureNow(
                keccak256(abi.encode(DS_IS_WHITELISTED, _account)),
                _whitelistedSig
            ),
            "TrippyNFTs: not whitelisted"
        );
    }
}
