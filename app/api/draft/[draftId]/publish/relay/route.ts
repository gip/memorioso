import { NextRequest, NextResponse } from 'next/server'
import { isHex, type Hex } from 'viem'
import { pool } from '@/lib/db'
import { getAuthenticatedUser } from '@/lib/auth-user'
import { getLibroRelayerConfig, getLibroServerConfig } from '@/lib/libro/config'
import {
  sendRelayedLibroRegistration,
  waitForRelayedLibroRegistration,
} from '@/lib/libro/relay'
import type { LibroRegistrationTransaction } from '@/lib/libro/proof'

type RelayRequest = {
  registrationId?: string
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ draftId: string }> }
): Promise<NextResponse> {
  const authenticatedUser = await getAuthenticatedUser()
  if (!authenticatedUser) {
    return NextResponse.json({ success: false, message: 'Authentication required' }, { status: 401 })
  }

  let libroConfig
  let relayerConfig
  try {
    libroConfig = getLibroServerConfig()
    relayerConfig = getLibroRelayerConfig()
  } catch (error) {
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : 'Libro relayer configuration is invalid',
    }, { status: 500 })
  }

  const { registrationId } = await req.json() as RelayRequest
  const { draftId } = await params
  if (!registrationId) {
    return NextResponse.json({ success: false, message: 'Registration is required' }, { status: 400 })
  }

  const client = await pool.connect()
  let transactionOpen = false

  try {
    await client.query('BEGIN')
    transactionOpen = true

    const registrationResult = await client.query(
      `SELECT transaction, chain_id, registry_address, transaction_hash, finalized_at
       FROM libro_publish_registrations
       WHERE id = $1 AND "draftId" = $2 AND "userId" = $3
       FOR UPDATE`,
      [registrationId, draftId, authenticatedUser.id]
    )

    if (registrationResult.rows.length === 0) {
      await client.query('ROLLBACK')
      transactionOpen = false
      return NextResponse.json({ success: false, message: 'Libro registration not found' }, { status: 404 })
    }

    const registration = registrationResult.rows[0]
    if (registration.finalized_at) {
      await client.query('ROLLBACK')
      transactionOpen = false
      return NextResponse.json({ success: false, message: 'Libro registration has already been finalized' }, { status: 400 })
    }

    if (
      registration.chain_id !== libroConfig.chainId ||
      registration.registry_address.toLowerCase() !== libroConfig.registryAddress.toLowerCase()
    ) {
      await client.query('ROLLBACK')
      transactionOpen = false
      return NextResponse.json({
        success: false,
        message: 'Libro registration configuration changed after preparation',
      }, { status: 400 })
    }

    let transactionHash = registration.transaction_hash as string | null
    if (!transactionHash) {
      // Serialize sends from the shared relayer EOA so concurrent requests cannot reuse a nonce.
      await client.query('SELECT pg_advisory_xact_lock($1)', [480_001])
      transactionHash = await sendRelayedLibroRegistration(
        registration.transaction as LibroRegistrationTransaction,
        libroConfig,
        relayerConfig
      )

      await client.query(
        `UPDATE libro_publish_registrations
         SET transaction_hash = $1
         WHERE id = $2`,
        [transactionHash.toLowerCase(), registrationId]
      )
    }

    await client.query('COMMIT')
    transactionOpen = false

    if (!isHex(transactionHash)) {
      throw new Error('Stored Libro transaction hash is invalid')
    }

    await waitForRelayedLibroRegistration(transactionHash as Hex, libroConfig)

    return NextResponse.json({
      success: true,
      transactionHash: transactionHash.toLowerCase(),
    })
  } catch (error) {
    if (transactionOpen) {
      await client.query('ROLLBACK')
    }
    console.error('Failed to relay Libro registration', { draftId, registrationId, error })
    return NextResponse.json({
      success: false,
      message: 'Failed to submit sponsored Libro registration',
    }, { status: 500 })
  } finally {
    client.release()
  }
}
