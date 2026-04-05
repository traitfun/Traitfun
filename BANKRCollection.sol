// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title BANKRCollection
 * @notice Single NFT collection deployed by a creator.
 *         1000 NFTs, price starts at 1 $BANKR and increases by 1 per mint.
 *         Creator earns revenue; platform takes a fee.
 */
contract BANKRCollection is ERC721URIStorage, ReentrancyGuard {

    // ─── Immutables ────────────────────────────────────────────────
    IERC20  public immutable bankrToken;
    address public immutable creator;
    address public immutable platform;
    uint256 public immutable platformFeeBps; // e.g. 500 = 5%
    uint256 public immutable royaltyBps;     // creator royalty on secondary
    uint256 public constant  MAX_SUPPLY = 1000;

    // ─── State ─────────────────────────────────────────────────────
    string  public collectionName;
    string  public prompt;
    string  public baseMetadataURI;   // ipfs://Qm.../
    uint256 public totalMinted;
    bool    public metadataRevealed;

    // ─── Events ────────────────────────────────────────────────────
    event Minted(
        address indexed buyer,
        uint256 indexed tokenId,
        uint256 pricePaid
    );
    event MetadataRevealed(string baseURI);
    event Withdrawn(address indexed to, uint256 amount);

    // ─── Errors ────────────────────────────────────────────────────
    error SoldOut();
    error InsufficientAllowance();
    error InsufficientBalance();
    error NotPlatform();
    error AlreadyRevealed();

    // ─── Constructor ───────────────────────────────────────────────
    constructor(
        string  memory _name,
        string  memory _symbol,
        string  memory _prompt,
        address _creator,
        address _platform,
        address _bankrToken,
        uint256 _platformFeeBps,
        uint256 _royaltyBps
    ) ERC721(_name, _symbol) {
        collectionName   = _name;
        prompt           = _prompt;
        creator          = _creator;
        platform         = _platform;
        bankrToken       = IERC20(_bankrToken);
        platformFeeBps   = _platformFeeBps;
        royaltyBps       = _royaltyBps;
    }

    // ─── Views ─────────────────────────────────────────────────────

    /// @notice Current mint price in $BANKR (18 decimals)
    function currentPrice() public view returns (uint256) {
        return (totalMinted + 1) * 1e18;
    }

    /// @notice Next token ID to be minted
    function nextTokenId() public view returns (uint256) {
        return totalMinted + 1;
    }

    function remaining() public view returns (uint256) {
        return MAX_SUPPLY - totalMinted;
    }

    // ─── Mint ──────────────────────────────────────────────────────

    /**
     * @notice Mint the next NFT. Buyer must pre-approve this contract
     *         for at least currentPrice() $BANKR.
     */
    function mint() external nonReentrant returns (uint256 tokenId) {
        if (totalMinted >= MAX_SUPPLY) revert SoldOut();

        uint256 price = currentPrice();

        // Check allowance & balance
        if (bankrToken.allowance(msg.sender, address(this)) < price)
            revert InsufficientAllowance();
        if (bankrToken.balanceOf(msg.sender) < price)
            revert InsufficientBalance();

        // Split: platform fee + creator revenue
        uint256 platformCut = (price * platformFeeBps) / 10_000;
        uint256 creatorCut  = price - platformCut;

        bankrToken.transferFrom(msg.sender, platform, platformCut);
        bankrToken.transferFrom(msg.sender, creator,  creatorCut);

        // Mint
        tokenId = nextTokenId();
        totalMinted++;
        _mint(msg.sender, tokenId);

        // Set token URI if metadata already revealed
        if (metadataRevealed) {
            _setTokenURI(tokenId, string(abi.encodePacked(
                baseMetadataURI, _toString(tokenId), ".json"
            )));
        }

        emit Minted(msg.sender, tokenId, price);
    }

    // ─── Platform: reveal metadata after AI generation ─────────────

    /**
     * @notice Called by platform after 1000 images are generated & pinned to IPFS.
     *         Sets base URI and updates existing token URIs.
     */
    function revealMetadata(string calldata _baseURI) external {
        if (msg.sender != platform) revert NotPlatform();
        if (metadataRevealed)       revert AlreadyRevealed();

        baseMetadataURI  = _baseURI;
        metadataRevealed = true;

        // Retroactively set URIs for already-minted tokens
        for (uint256 i = 1; i <= totalMinted; i++) {
            _setTokenURI(i, string(abi.encodePacked(
                _baseURI, _toString(i), ".json"
            )));
        }

        emit MetadataRevealed(_baseURI);
    }

    // ─── ERC-2981 Royalty Info (for marketplaces) ──────────────────
    function royaltyInfo(uint256, uint256 salePrice)
        external view
        returns (address receiver, uint256 royaltyAmount)
    {
        receiver      = creator;
        royaltyAmount = (salePrice * royaltyBps) / 10_000;
    }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721URIStorage)
        returns (bool)
    {
        return interfaceId == 0x2a55205a // ERC-2981
            || super.supportsInterface(interfaceId);
    }

    // ─── Internal helpers ──────────────────────────────────────────
    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) { digits++; temp /= 10; }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits--;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}
