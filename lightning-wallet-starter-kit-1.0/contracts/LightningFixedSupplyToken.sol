// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Fixed-supply token used by the client-side testnet Launchpad adapter.
/// The deploying wallet receives the full supply. No privileged mint function exists.
contract LightningFixedSupplyToken is ERC20 {
    uint8 private immutable _tokenDecimals;

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        uint256 initialSupply_
    ) ERC20(name_, symbol_) {
        _tokenDecimals = decimals_;
        _mint(msg.sender, initialSupply_);
    }

    function decimals() public view override returns (uint8) {
        return _tokenDecimals;
    }
}
