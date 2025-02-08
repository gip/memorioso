//import { Network, Alchemy } from 'alchemy-sdk'
import { ethers } from 'ethers'
// Configure the SDK
// const config = {
//   apiKey: process.env.ALCHEMY_API_KEY,
//   network: Network.WORLDCHAIN_MAINNET,
// }
// const alchemy = new Alchemy(config)

const tokenABI = [
    "function transfer(address to, uint256 amount) returns (bool)"
  ];
  
// USDC.e contract address - https://worldscan.org/address/0x79A02482A880bCE3F13e09Da970dC34db4CD24d1
const usdceAddress = "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1"

export async function sendUSDCe(recipientAddress: string, amount: number) {

  console.log('SND', recipientAddress, amount)

  const provider = new ethers.JsonRpcProvider("https://worldchain-mainnet.g.alchemy.com/v2/-2-A9u6Vnchf_tzfaPLLevdjDKZsrr6_");

  // Create wallet instance
  const wallet = new ethers.Wallet(process.env.WALLET_SECRET_KEY || '', provider)
  console.log('WAD', wallet.address)

  // Create contract instance
  const usdceContract = new ethers.Contract(usdceAddress, tokenABI, wallet)

  // USDC.e has 6 decimal places
  const amountInSmallestUnit = ethers.parseUnits(amount.toString(), 6)

  // Send transaction
  const tx = await usdceContract.transfer(recipientAddress, amountInSmallestUnit)

  // Wait for transaction to be mined
  const receipt = await tx.wait()
  return receipt
}