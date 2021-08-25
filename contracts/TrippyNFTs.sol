// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.7;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract TrippyNFTs is ERC721URIStorage, Ownable {
    struct SaleParams {
        uint64 price;
        uint32 start;
        uint32 end;
        uint32 maxBuys;
        uint64 totalMaxBuys;
    }

    struct Sale {
        SaleParams params;
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

    address internal verifier;

    Sale public whitelistedSale;
    Sale public publicSale;

    constructor(
        string memory name_,
        string memory symbol_,
        SaleParams memory _whitelistedSaleParams,
        address _verifier
    )
        ERC721(name_, symbol_)
        Ownable()
    {
        whitelistedSale.params = _whitelistedSaleParams;
        verifier = _verifier;
    }

    function doWhitelistBuy(bytes memory _whitelistedSig) external payable {
        (
            uint256 newBuys,
            uint256 newTotalBuys,
            uint256 refund
        ) = _checkSale(whitelistedSale, msg.value, msg.sender);
    }

    function _checkSale(Sale storage _sale, uint256 _msgValue, address _buyer)
        internal
        view
        returns (uint256 newBuys, uint256 newTotalBuys, uint256 refund)
    {
        _checkTime(_sale.params);
        (newBuys, newTotalBuys, refund) = _checkValue(_sale, msgValue, buyer);
    }

    function _checkTime(SaleParams storage _params) internal {
        uint256 timestamp = block.timestamp;
        require(timestamp >= _params.start, "TrippyNFTs: before sale");
        require(timestamp <= _params.end, "TrippyNFTs: after sale");
    }

    function _checkValue(Sale storage _sale, uint256 _msgValue, address _buyer)
        internal
        view
        returns (uint256 newBuys, uint256 newTotalBuys, uint256 refund)
    {
        require(_msgValue > 0, "TrippyNFTs: no funds");
        uint256 price = uint256(_sale.params.price);
        uint256 maxBuys = uint256(_sale.params.maxBuys);
        newBuys = _msgValue / price;
        newTotalBuys = _sale.buys[_buyer] + newBuys;
        require(newTotalBuys <= maxBuys, "TrippyNFTs: can't buy more");
        refund = _msgValue % price;
    }
}
