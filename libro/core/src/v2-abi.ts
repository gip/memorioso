// Generated from LibroRegistryV2.sol; verify against the Foundry artifact when changing the contract.
export const libroRegistryV2Abi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "predecessor",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "verifier",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "relyingPartyId",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "AGENT_DOCUMENT_TYPEHASH",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "AGENT_REGISTRATION_TYPEHASH",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "EIP712_DOMAIN_TYPEHASH",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "NAME_HASH",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "PUBLICATION_COMMITMENT_TYPEHASH",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "SCOPE_PUBLISH_DOCUMENT",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "VERSION_HASH",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "agentDocumentRegistrations",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "agentRegistrations",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "handleHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "controllerAddress",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "agentAddress",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "scope",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "validFrom",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "expiresAt",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "revoked",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "claimHandle",
    "inputs": [
      {
        "name": "handle",
        "type": "string",
        "internalType": "string"
      },
      {
        "name": "proof",
        "type": "tuple",
        "internalType": "struct LibroRegistryV2.WorldIdSessionProof",
        "components": [
          {
            "name": "sessionCommitment",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "nonce",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "expiresAtMin",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "issuerSchemaId",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "credentialGenesisIssuedAtMin",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "sessionNullifier",
            "type": "uint256[2]",
            "internalType": "uint256[2]"
          },
          {
            "name": "zeroKnowledgeProof",
            "type": "uint256[5]",
            "internalType": "uint256[5]"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "domainSeparator",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getAgentRegistrationHash",
    "inputs": [
      {
        "name": "registration",
        "type": "tuple",
        "internalType": "struct LibroRegistryV2.AgentRegistration",
        "components": [
          {
            "name": "handleHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "controllerAddress",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "agentAddress",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "scope",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "validFrom",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "expiresAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "salt",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getAgentRegistrationSignalHash",
    "inputs": [
      {
        "name": "registration",
        "type": "tuple",
        "internalType": "struct LibroRegistryV2.AgentRegistration",
        "components": [
          {
            "name": "handleHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "controllerAddress",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "agentAddress",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "scope",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "validFrom",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "expiresAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "salt",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getHandleClaimSignalHash",
    "inputs": [
      {
        "name": "handle",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "getPublicationSignalHash",
    "inputs": [
      {
        "name": "handleHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "commitment",
        "type": "tuple",
        "internalType": "struct LibroRegistryV2.PublicationCommitment",
        "components": [
          {
            "name": "payloadHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "previousRegistry",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "previousSignalHash",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "name": "authorshipClass",
        "type": "uint8",
        "internalType": "uint8"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "getPublicationStatus",
    "inputs": [
      {
        "name": "registry",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "signalHash",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "status",
        "type": "tuple",
        "internalType": "struct LibroRegistryV2.PublicationStatus",
        "components": [
          {
            "name": "exists",
            "type": "bool",
            "internalType": "bool"
          },
          {
            "name": "originalRegistry",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "handleHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "authorshipClass",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "previous",
            "type": "tuple",
            "internalType": "struct LibroRegistryV2.PublicationReference",
            "components": [
              {
                "name": "registry",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "signalHash",
                "type": "uint256",
                "internalType": "uint256"
              }
            ]
          },
          {
            "name": "next",
            "type": "tuple",
            "internalType": "struct LibroRegistryV2.PublicationReference",
            "components": [
              {
                "name": "registry",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "signalHash",
                "type": "uint256",
                "internalType": "uint256"
              }
            ]
          },
          {
            "name": "root",
            "type": "tuple",
            "internalType": "struct LibroRegistryV2.PublicationReference",
            "components": [
              {
                "name": "registry",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "signalHash",
                "type": "uint256",
                "internalType": "uint256"
              }
            ]
          },
          {
            "name": "latest",
            "type": "tuple",
            "internalType": "struct LibroRegistryV2.PublicationReference",
            "components": [
              {
                "name": "registry",
                "type": "address",
                "internalType": "address"
              },
              {
                "name": "signalHash",
                "type": "uint256",
                "internalType": "uint256"
              }
            ]
          },
          {
            "name": "revisionNumber",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "isLatest",
            "type": "bool",
            "internalType": "bool"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "handleSessionCommitments",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "hashHandle",
    "inputs": [
      {
        "name": "handle",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "humanDocumentHandles",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "importHandle",
    "inputs": [
      {
        "name": "handleHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "publicationKey",
    "inputs": [
      {
        "name": "registry",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "signalHash",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "pure"
  },
  {
    "type": "function",
    "name": "referenceV1Publication",
    "inputs": [
      {
        "name": "signalHash",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "registerAgent",
    "inputs": [
      {
        "name": "registration",
        "type": "tuple",
        "internalType": "struct LibroRegistryV2.AgentRegistration",
        "components": [
          {
            "name": "handleHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "controllerAddress",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "agentAddress",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "scope",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "validFrom",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "expiresAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "salt",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      },
      {
        "name": "proof",
        "type": "tuple",
        "internalType": "struct LibroRegistryV2.WorldIdSessionProof",
        "components": [
          {
            "name": "sessionCommitment",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "nonce",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "expiresAtMin",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "issuerSchemaId",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "credentialGenesisIssuedAtMin",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "sessionNullifier",
            "type": "uint256[2]",
            "internalType": "uint256[2]"
          },
          {
            "name": "zeroKnowledgeProof",
            "type": "uint256[5]",
            "internalType": "uint256[5]"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "registerAgentPublication",
    "inputs": [
      {
        "name": "registrationHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "commitment",
        "type": "tuple",
        "internalType": "struct LibroRegistryV2.PublicationCommitment",
        "components": [
          {
            "name": "payloadHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "previousRegistry",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "previousSignalHash",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "name": "documentNonce",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "signedAt",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "signature",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "registerHumanPublication",
    "inputs": [
      {
        "name": "handleHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "commitment",
        "type": "tuple",
        "internalType": "struct LibroRegistryV2.PublicationCommitment",
        "components": [
          {
            "name": "payloadHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "previousRegistry",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "previousSignalHash",
            "type": "uint256",
            "internalType": "uint256"
          }
        ]
      },
      {
        "name": "proof",
        "type": "tuple",
        "internalType": "struct LibroRegistryV2.WorldIdSessionProof",
        "components": [
          {
            "name": "sessionCommitment",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "nonce",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "expiresAtMin",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "issuerSchemaId",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "credentialGenesisIssuedAtMin",
            "type": "uint256",
            "internalType": "uint256"
          },
          {
            "name": "sessionNullifier",
            "type": "uint256[2]",
            "internalType": "uint256[2]"
          },
          {
            "name": "zeroKnowledgeProof",
            "type": "uint256[5]",
            "internalType": "uint256[5]"
          }
        ]
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "revokeAgent",
    "inputs": [
      {
        "name": "registrationHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "rpId",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "sessionCommitmentHandles",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "usedSessionNullifiers",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "v1Registry",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract LibroRegistry"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "verifyAgent",
    "inputs": [
      {
        "name": "registrationHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "handleHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "verifyAgentDocument",
    "inputs": [
      {
        "name": "documentSignalHash",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "handleHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "verifyHumanDocument",
    "inputs": [
      {
        "name": "documentSignalHash",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "handleHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "worldIdVerifier",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IWorldIDVerifier"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "AgentDocumentRegistered",
    "inputs": [
      {
        "name": "documentSignalHash",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "registrationHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "handleHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "agentAddress",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "documentNonce",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "signedAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "AgentRegistered",
    "inputs": [
      {
        "name": "registrationHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "handleHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "agentAddress",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "controllerAddress",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "scope",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "expiresAt",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "sessionNullifier",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "AgentRevoked",
    "inputs": [
      {
        "name": "registrationHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "handleHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "HandleClaimed",
    "inputs": [
      {
        "name": "handleHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "sessionCommitment",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "HumanDocumentRegistered",
    "inputs": [
      {
        "name": "documentSignalHash",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "handleHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "sessionNullifier",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "PublicationUpdated",
    "inputs": [
      {
        "name": "previousSignalHash",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "newSignalHash",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "handleHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "previousRegistry",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "rootRegistry",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "rootSignalHash",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "revisionNumber",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "V1PublicationReferenced",
    "inputs": [
      {
        "name": "signalHash",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "handleHash",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "sourceRegistry",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "authorshipClass",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AgentAlreadyRegistered",
    "inputs": [
      {
        "name": "registrationHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "AgentCannotReviseHuman",
    "inputs": []
  },
  {
    "type": "error",
    "name": "AgentNotRegistered",
    "inputs": [
      {
        "name": "registrationHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "AgentRegistrationExpired",
    "inputs": [
      {
        "name": "registrationHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "AgentRegistrationNotYetValid",
    "inputs": [
      {
        "name": "registrationHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "AgentRevokedError",
    "inputs": [
      {
        "name": "registrationHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "DocumentAlreadyRegistered",
    "inputs": [
      {
        "name": "documentSignalHash",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "HandleAlreadyClaimed",
    "inputs": [
      {
        "name": "handleHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "HandleNotClaimed",
    "inputs": [
      {
        "name": "handleHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "InvalidAgentSignature",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidDocumentSignalHash",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidHandle",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidPredecessor",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidRegistration",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidRpId",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidSessionCommitment",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidSignatureLength",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidVerifier",
    "inputs": []
  },
  {
    "type": "error",
    "name": "RevisionConflict",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SessionAlreadyClaimed",
    "inputs": [
      {
        "name": "sessionCommitment",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "SessionDoesNotOwnHandle",
    "inputs": [
      {
        "name": "handleHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ]
  },
  {
    "type": "error",
    "name": "SessionNullifierAlreadyUsed",
    "inputs": [
      {
        "name": "nullifier",
        "type": "uint256",
        "internalType": "uint256"
      }
    ]
  },
  {
    "type": "error",
    "name": "UnauthorizedController",
    "inputs": []
  }
] as const
