// import { Network, Alchemy } from 'alchemy-sdk'
import { ethers } from 'ethers'

const tokenABI = [
    "function transfer(address to, uint256 amount) returns (bool)"
]

export async function sendUSDCe(recipientAddress: string, amount: string) {

  if (!recipientAddress) {
      throw new Error("Recipient address is required");
  }

  const provider = new ethers.JsonRpcProvider(process.env.ALCHEMY_RPC_URL || '')
  
  // Add error checking for wallet creation
  const wallet = new ethers.Wallet(process.env.WALLET_SECRET_KEY || '', provider)
  
  // Add logging to verify contract address
  const usdceAddress = '0x79A02482A880bCE3F13e09Da970dC34db4CD24d1'
  console.log("Using USDC.e address:", usdceAddress)
  
  // Verify contract exists
  const code = await provider.getCode(usdceAddress);
  if (code === '0x') {
      throw new Error("No contract found at the specified address");
  }
  
  const usdceContract = new ethers.Contract(usdceAddress, tokenABI, wallet)
  const amountInSmallestUnit = ethers.parseUnits(amount.toString(), 6)
  
  // Add logging for debugging
  console.log("Sending amount:", amountInSmallestUnit.toString())
  console.log("To address:", recipientAddress)
  
  const tx = await usdceContract.transfer(recipientAddress, amountInSmallestUnit)
  const receipt = await tx.wait()
  console.log("Transaction hash:", receipt.transactionHash)
  return receipt
}