// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./BANKRCollection.sol";

/**
 * @title BANKRFactory
 * @notice Creators pay a flat $BANKR fee to deploy a new NFT collection.
 *         The factory stores all deployed collection addresses.
 */
contract BANKRFactory is Ownable {

    // ─── Config ────────────────────────────────────────────────────
    IERC20  public immutable bankrToken;
    uint256 public deployFee    = 60 * 1e18;   // 60 $BANKR to launch
    uint256 public platformBps  = 500;          // 5% of each mint to platform
    address public platformWallet;

    // ─── State ─────────────────────────────────────────────────────
    address[] public allCollections;
    mapping(address => address[]) public creatorCollections;
    mapping(address => bool)      public isCollection;

    // ─── Events ────────────────────────────────────────────────────
    event CollectionDeployed(
        address indexed collection,
        address indexed creator,
        string  name,
        string  prompt
    );
    event DeployFeeUpdated(uint256 newFee);
    event PlatformBpsUpdated(uint256 newBps);

    // ─── Errors ────────────────────────────────────────────────────
    error InsufficientFeeAllowance();
    error InsufficientFeeBalance();
    error InvalidRoyalty();
    error EmptyName();
    error EmptyPrompt();

    constructor(address _bankrToken, address _platformWallet)
        Ownable(msg.sender)
    {
        bankrToken      = IERC20(_bankrToken);
        platformWallet  = _platformWallet;
    }

    // ─── Deploy ────────────────────────────────────────────────────

    /**
     * @notice Deploy a new BANKRCollection.
     * @param name         Collection name (e.g. "CYBER SAMURAI")
     * @param symbol       Token symbol (e.g. "CSAM")
     * @param prompt       AI prompt used to generate 1000 images
     * @param royaltyBps   Creator royalty on secondary sales (max 1500 = 15%)
     */
    function deployCollection(
        string calldata name,
        string calldata symbol,
        string calldata prompt,
        uint256         royaltyBps
    ) external returns (address collection) {

        if (bytes(name).length   == 0) revert EmptyName();
        if (bytes(prompt).length == 0) revert EmptyPrompt();
        if (royaltyBps > 1500)         revert InvalidRoyalty();

        // Collect deploy fee from creator
        if (bankrToken.allowance(msg.sender, address(this)) < deployFee)
            revert InsufficientFeeAllowance();
        if (bankrToken.balanceOf(msg.sender) < deployFee)
            revert InsufficientFeeBalance();

        bankrToken.transferFrom(msg.sender, platformWallet, deployFee);

        // Deploy collection contract
        BANKRCollection col = new BANKRCollection(
            name,
            symbol,
            prompt,
            msg.sender,       // creator
            platformWallet,   // platform
            address(bankrToken),
            platformBps,
            royaltyBps
        );

        collection = address(col);
        allCollections.push(collection);
        creatorCollections[msg.sender].push(collection);
        isCollection[collection] = true;

        emit CollectionDeployed(collection, msg.sender, name, prompt);
    }

    // ─── Views ─────────────────────────────────────────────────────

    function totalCollections() external view returns (uint256) {
        return allCollections.length;
    }

    function getCollections(uint256 offset, uint256 limit)
        external view
        returns (address[] memory)
    {
        uint256 total = allCollections.length;
        if (offset >= total) return new address[](0);
        uint256 end = offset + limit > total ? total : offset + limit;
        address[] memory result = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = allCollections[i];
        }
        return result;
    }

    function getCreatorCollections(address creator)
        external view
        returns (address[] memory)
    {
        return creatorCollections[creator];
    }

    // ─── Admin ─────────────────────────────────────────────────────

    function setDeployFee(uint256 fee) external onlyOwner {
        deployFee = fee;
        emit DeployFeeUpdated(fee);
    }

    function setPlatformBps(uint256 bps) external onlyOwner {
        require(bps <= 1000, "Max 10%");
        platformBps = bps;
        emit PlatformBpsUpdated(bps);
    }

    function setPlatformWallet(address wallet) external onlyOwner {
        platformWallet = wallet;
    }
}
