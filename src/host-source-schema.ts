/** Generated from approved document definitions only. No peer implementation/SDK input.
 * C-world-facts v2/D176; C-canvas v6/D178; C-session v2 section 13/D181.
 * C-world-facts SHA256 c1a296c8a422e1ca8ff6a30111db465465c047cdedd03f43e9a59dbf6620e4b9
 * C-canvas SHA256 c6b03a48ec03b5843e10e95016005f6be4fefc1ce29fb4399792358d094083da
 * C-session SHA256 9f4b559c281d0839eecd5a64c07667373749569eb6e6cd55fa5ef61f191f2376
 */
export type JSONValue = null | boolean | number | string | JSONValue[] | { [key: string]: JSONValue }
export type AvatarEnvelope = (KnownAvatarEnvelope) | (AvatarEnvelopeFact)
export type AvatarEnvelopeFact = { "availability": "UNAVAILABLE"; "reason": "NO_PUBLIC_SOURCE" }
export type AvatarSize = { "width": PositiveFinite; "height": PositiveFinite; "depth": PositiveFinite }
export type Bool = boolean
export type CanvasCatalogueRequest = { "sessionRef": Ref; "expectedConnection"?: MaterialSourceConnection; "expectedCatalogueDigest"?: Digest; "expectedProvider"?: FactsProviderIdentity }
export type Catalogue = { "profileVersion": "catalogue/v3"; "engineRevisions": EngineRevisions; "emptyMaterialRef": Ref; "materials": MaterialTagMap }
export type CatalogueFacts = { "profileVersion": "catalogue-facts/v1"; "connection": MaterialSourceConnection; "catalogue": Catalogue; "catalogueDigest": Digest; "presentation": MaterialPresentationMap; "orientationIndex": OrientationIndex }
export type CatalogueHostFacts = { "provider": FactsProviderIdentity; "facts": CatalogueFacts }
export type CompilationConfig = { "profileVersion": "compilation-config/v3"; "writeBackend": WriteBackendRef; "overlapRule": "last-writer-wins"; "effectOrder": "numeric-x-y-z"; "compressionRule": "exact-final-effects-only" }
export type Digest = string
export type EngineRevisions = Record<string, Revision>
export type Error = { "code": ErrorCode; "phase": Phase; "retryability": Retryability; "mutationState": MutationState; "transactionRef": (Ref) | (null); "causeCode": (ErrorCode) | (null); "reason": ErrorReason; "worldRef"?: Ref; "source"?: FailureSource }
export type ErrorCode = "SCHEMA_INVALID" | "NON_CANONICAL_AMBIGUITY" | "UNSUPPORTED_VERSION" | "UNKNOWN_REQUIRED_FIELD" | "CAPABILITY_UNAVAILABLE" | "INVALID_FRAME" | "UNKNOWN_ACTION" | "STALE_REVISION" | "RENDERER_CAPABILITY_UNAVAILABLE" | "ADAPTER_UNAVAILABLE" | "CONNECTION_NOT_FOUND" | "WORLD_NOT_FOUND" | "PAYLOAD_VERSION_MISMATCH" | "REPLAY_MISMATCH" | "WORLD_NOT_BOUND" | "OBJECT_NOT_FOUND" | "OBJECT_SCOPE_MISMATCH" | "INVALID_NAME" | "OBJECT_NAME_CONFLICT" | "INVALID_SELECTION" | "DUPLICATE_OBJECT_REF" | "INSPECTION_FAILED" | "OTHER_OBJECTS_AFFECTED" | "TRANSACTION_CONFLICT" | "STALE_TRANSACTION" | "APPLY_FAILED" | "READBACK_FAILED" | "READBACK_MISMATCH" | "RESTORE_FAILED" | "ROLLBACK_FAILED" | "RECOVERY_PENDING" | "UNDO_CONFLICT" | "REDO_CONFLICT" | "REDO_UNAVAILABLE" | "SESSION_NOT_FOUND" | "AMBIGUOUS_INTENT" | "CROSS_WORLD_REFERENCE_AMBIGUOUS" | "MODEL_UNAVAILABLE" | "MODEL_REQUEST_FAILED" | "ATTACHMENT_REJECTED" | "SESSION_DELETE_UNSUPPORTED" | "SAVED_RESOURCE_UNAVAILABLE" | "RESOURCE_EXPIRED" | "INTENT_UNCONFIRMED" | "IMAGE_REQUIRED" | "TARGET_REQUIRED" | "TARGET_FACTS_STALE" | "TARGET_FACTS_INCOMPLETE" | "AMBIGUOUS_GEOMETRY" | "UNSUPPORTED_MATERIAL" | "BUILD_INVALID" | "MEDIA_BINDING_INVALID" | "MEDIA_DIGEST_MISMATCH" | "TURN_REVISION_MISMATCH" | "UNSUPPORTED_MEDIA_TYPE" | "MEDIA_TOO_LARGE" | "UNSUPPORTED_OPERATION" | "CATALOGUE_MISMATCH" | "SAFETY_INVARIANT_FAILED" | "UNSUPPORTED_MUTATION_SEMANTICS" | "LIMIT_EXCEEDED" | "CURRENT_WORLD_MISMATCH" | "REQUEST_CANCELLED" | "REQUEST_NOT_ACTIVE" | "CAPABILITY_GAP"
export type ErrorReason = "INVALID_UTF8" | "DUPLICATE_DECODED_KEY" | "LONE_SURROGATE" | "INVALID_NUMBER" | "INVALID_SHAPE" | "UNKNOWN_FIELD" | "VERSION_UNSUPPORTED" | "IDENTITY_UNVERIFIED" | "SCOPE_DENIED" | "PAYLOAD_CHANGED" | "REVISION_CHANGED" | "INVALID_GEOMETRY" | "CATALOGUE_UNRESOLVED" | "REQUIRED_FACT_UNKNOWN" | "POLICY_UNAVAILABLE" | "LIMIT_EXCEEDED" | "NAME_FORBIDDEN_CHARACTER" | "NAME_INVISIBLE_OR_EMPTY" | "NAME_KEY_EXISTS" | "MEDIA_NOT_REFERENCED" | "MEDIA_CORRUPT" | "DELETE_SEAM_ABSENT" | "RESOURCE_MISSING" | "UNSUPPORTED_STATE_COVERAGE" | "APPLY_ERROR" | "READBACK_ERROR" | "RESTORE_ERROR" | "PERSIST_ERROR" | "EXTERNAL_EDIT_CONFLICT" | "TRANSPORT_OUTCOME_UNKNOWN" | "OWNERSHIP_VIOLATION" | "GEOMETRY_PROFILE_UNSUPPORTED"
export type FactsProviderIdentity = { "providerRef": Ref; "providerRevision": Ref }
export type FailureSource = { "owner": "world-source"; "operation": Ref; "resource": Ref; "kind": "INVALID_CONFIG" | "NOT_FOUND" | "PERMISSION" | "IO" | "CORRUPT" | "VERSION" | "LIMIT" | "WAIT_EXPIRED" | "UNSAFE_PATH"; "nativeCode": (string) | (null) }
export type FieldNames = (Ref)[]
export type KnownAvatarEnvelope = { "availability": "KNOWN"; "basis": "WORLD_SOURCE_DECLARATION"; "size": AvatarSize }
export type KnownMaterialSource = { "availability": "KNOWN"; "materialRef": Ref; "orientation": Orientation; "definitionRevision": Revision; "texture": MaterialTextureSource }
export type KnownWriteBackend = { "availability": "KNOWN"; "basis": "LOADED_PAYLOAD_DECLARATION"; "writeBackend": WriteBackendRef }
export type MaterialPresentation = { "displayName": (Text) | (null); "color": (SrgbColor) | (null) }
export type MaterialPresentationMap = Record<string, MaterialPresentation>
export type MaterialSource = (KnownMaterialSource) | (UnknownMaterialSource)
export type MaterialSourceConnection = { "worldRef": Ref; "connectionRef": Ref; "connectionIncarnationRef": Ref }
export type MaterialSourceFacts = { "profileVersion": "material-source-facts/v1"; "snapshot": MaterialSourcesSnapshot; "presentation": MaterialPresentationMap }
export type MaterialSourceUnknownReason = "UNKNOWN_ORIENTATION" | "UNKNOWN_DEFINITION" | "MISSING_TEXTURE" | "UNRESOLVED_SOURCE" | "UNSUPPORTED_APPEARANCE"
export type MaterialSourcesSnapshot = { "profileVersion": "material-sources/v2"; "connection": MaterialSourceConnection; "catalogueDigest": Digest; "engineRevisions": EngineRevisions; "sourceBasis": "WORLD_SOURCE_ASSET_ONLY"; "materials": (MaterialSource)[]; "sourceRevision": Digest }
export type MaterialTagMap = Record<string, MaterialTags>
export type MaterialTags = { "passable": (Bool) | (null); "liquid": (Bool) | (null); "hazardPerSecond": (NonNegativeFinite) | (null); "emitsLight": (Bool) | (null); "placeable": (Bool) | (null); "orientations": (Orientations) | (null); "definitionRevision": (Revision) | (null); "unknownFields": FieldNames; "extension": OpaqueMap }
export type MaterialTextureSource = { "textureName": Ref; "sourceKind": "GAME" | "MOD"; "sourceRef": Ref; "interpretation": "SIMPLE_UNIFORM_NODE_TILES"; "mediaType": "image/png" | "image/jpeg" | "image/webp"; "bytesDigest": Digest; "byteLength": PositiveInt }
export type MutationState = "NONE" | "VERIFIED" | "ROLLED_BACK" | "PARTIAL" | "UNKNOWN"
export type NonNegativeFinite = number
export type OpaqueMap = Record<string, OpaqueValue>
export type OpaqueValue = JSONValue
export type Orientation = number
export type OrientationDescriptor = { "orientation": Orientation; "quarterTurnsAboutUp": (QuarterTurns) | (null); "upsideDown": (Bool) | (null) }
export type OrientationIndex = (OrientationDescriptor)[]
export type Orientations = (Orientation)[]
export type Phase = "decode" | "replay" | "validate" | "apply" | "readback" | "restore" | "persist"
export type PositiveFinite = number
export type PositiveInt = number
export type QuarterTurns = number
export type ReadWriteProfileRequest = { "contractVersion": "world-facts/v1"; "requestId": Ref; "worldRef": Ref }
export type ReadWriteProfileResponse = { "contractVersion": "world-facts/v1"; "requestId": Ref; "result": (WriteProfile) | (null); "error": (Error) | (null) }
export type Ref = string
export type Retryability = "NEVER" | "AFTER_NEW_FACTS" | "SAME_TRANSACTION_QUERY" | "AFTER_MANUAL_RECOVERY"
export type Revision = string
export type SrgbColor = string
export type Text = string
export type UnavailableWriteBackend = { "availability": "UNAVAILABLE"; "reason": "NOT_DECLARED_BY_PAYLOAD" | "ENGINE_FACT_UNREADABLE" }
export type UnknownMaterialSource = { "availability": "UNKNOWN"; "materialRef": Ref; "orientation": (Orientation) | (null); "definitionRevision": (Revision) | (null); "texture": null; "reason": MaterialSourceUnknownReason }
export type WorldSourceTransportPolicy = { "profileVersion": "world-source-transport-policy/v1"; "owner": "world-source"; "settings": (WorldSourceTransportSetting)[] }
export type WorldSourceTransportSetting = { "name": Ref; "unit": "ms" | "byte"; "defaultValue": number; "value": number; "min": number; "max": number; "editable": boolean; "meaning": Ref; "tradeoff": Ref; "validation": Ref }
export type WriteBackendFact = (KnownWriteBackend) | (UnavailableWriteBackend)
export type WriteBackendRef = { "profileId": Ref; "revision": Revision }
export type WriteMethod = "PER_CELL" | "REGION"
export type WriteMethods = (WriteMethod)[]
export type WriteProfile = { "profileVersion": "write-profile/v1"; "connection": MaterialSourceConnection; "catalogueDigest": Digest; "writeBackend": WriteBackendFact; "compilationConfig": (CompilationConfig) | (null); "writeMethods": WriteMethods; "avatarEnvelope": AvatarEnvelope; "transportPolicy"?: WorldSourceTransportPolicy }

export const sourceDefinitions = {
  "AvatarEnvelope": {
    "x-typeName": "AvatarEnvelope",
    "oneOf": [
      {
        "$ref": "#/$defs/KnownAvatarEnvelope"
      },
      {
        "$ref": "#/$defs/AvatarEnvelopeFact"
      }
    ],
    "x-discriminator": "availability",
    "x-variantKeys": [
      "KNOWN",
      "UNAVAILABLE"
    ],
    "x-meaning": "The body envelope the world source declares for its player body: a fixed size it vouches for, the same for every player and every moment. Never a live position, yaw, posture or identity; players joining, leaving or moving never change it. UNAVAILABLE/NO_PUBLIC_SOURCE when the world source declares none; consumers then refuse by name, never fill a size."
  },
  "AvatarEnvelopeFact": {
    "x-typeName": "AvatarEnvelopeFact",
    "type": "object",
    "properties": {
      "availability": {
        "const": "UNAVAILABLE"
      },
      "reason": {
        "const": "NO_PUBLIC_SOURCE"
      }
    },
    "required": [
      "availability",
      "reason"
    ],
    "additionalProperties": false
  },
  "AvatarSize": {
    "x-typeName": "AvatarSize",
    "type": "object",
    "properties": {
      "width": {
        "$ref": "#/$defs/PositiveFinite"
      },
      "height": {
        "$ref": "#/$defs/PositiveFinite"
      },
      "depth": {
        "$ref": "#/$defs/PositiveFinite"
      }
    },
    "required": [
      "width",
      "height",
      "depth"
    ],
    "additionalProperties": false,
    "x-meaning": "Extent in Frame grid units: width along x, height along the up axis, depth along z."
  },
  "Bool": {
    "type": "boolean",
    "x-typeName": "Bool"
  },
  "CanvasCatalogueRequest": {
    "type": "object",
    "properties": {
      "sessionRef": {
        "$ref": "#/$defs/Ref"
      },
      "expectedConnection": {
        "$ref": "#/$defs/MaterialSourceConnection"
      },
      "expectedCatalogueDigest": {
        "$ref": "#/$defs/Digest"
      },
      "expectedProvider": {
        "$ref": "#/$defs/FactsProviderIdentity"
      }
    },
    "required": [
      "sessionRef"
    ],
    "additionalProperties": false
  },
  "Catalogue": {
    "type": "object",
    "properties": {
      "profileVersion": {
        "const": "catalogue/v3"
      },
      "engineRevisions": {
        "$ref": "#/$defs/EngineRevisions"
      },
      "emptyMaterialRef": {
        "$ref": "#/$defs/Ref"
      },
      "materials": {
        "$ref": "#/$defs/MaterialTagMap"
      }
    },
    "required": [
      "profileVersion",
      "engineRevisions",
      "emptyMaterialRef",
      "materials"
    ],
    "additionalProperties": false,
    "x-typeName": "Catalogue",
    "x-meaning": "The world source's own material vocabulary. emptyMaterialRef names the material that means an empty cell; it must be a key of materials."
  },
  "CatalogueFacts": {
    "x-typeName": "CatalogueFacts",
    "type": "object",
    "properties": {
      "profileVersion": {
        "const": "catalogue-facts/v1"
      },
      "connection": {
        "$ref": "#/$defs/MaterialSourceConnection"
      },
      "catalogue": {
        "$ref": "#/$defs/Catalogue"
      },
      "catalogueDigest": {
        "$ref": "#/$defs/Digest"
      },
      "presentation": {
        "$ref": "#/$defs/MaterialPresentationMap"
      },
      "orientationIndex": {
        "$ref": "#/$defs/OrientationIndex"
      }
    },
    "required": [
      "profileVersion",
      "connection",
      "catalogue",
      "catalogueDigest",
      "presentation",
      "orientationIndex"
    ],
    "additionalProperties": false,
    "x-meaning": "The world source material vocabulary with names, colours and the neutral orientation index. presentation has exactly the Catalogue materials as keys; orientationIndex describes every orientation any material declares."
  },
  "CatalogueHostFacts": {
    "type": "object",
    "properties": {
      "provider": {
        "$ref": "#/$defs/FactsProviderIdentity"
      },
      "facts": {
        "$ref": "#/$defs/CatalogueFacts"
      }
    },
    "required": [
      "provider",
      "facts"
    ],
    "additionalProperties": false
  },
  "CompilationConfig": {
    "type": "object",
    "properties": {
      "profileVersion": {
        "const": "compilation-config/v3"
      },
      "writeBackend": {
        "$ref": "#/$defs/WriteBackendRef"
      },
      "overlapRule": {
        "const": "last-writer-wins"
      },
      "effectOrder": {
        "const": "numeric-x-y-z"
      },
      "compressionRule": {
        "const": "exact-final-effects-only"
      }
    },
    "required": [
      "profileVersion",
      "writeBackend",
      "overlapRule",
      "effectOrder",
      "compressionRule"
    ],
    "additionalProperties": false,
    "x-typeName": "CompilationConfig"
  },
  "Digest": {
    "type": "string",
    "pattern": "^[0-9a-f]{64}$",
    "x-typeName": "Digest"
  },
  "EngineRevisions": {
    "type": "object",
    "propertyNames": {
      "$ref": "#/$defs/Ref"
    },
    "additionalProperties": {
      "$ref": "#/$defs/Revision"
    },
    "x-typeName": "EngineRevisions",
    "x-meaning": "Opaque revisions the world source reports for what defines its materials. Compared for equality only."
  },
  "Error": {
    "type": "object",
    "properties": {
      "code": {
        "$ref": "#/$defs/ErrorCode"
      },
      "phase": {
        "$ref": "#/$defs/Phase"
      },
      "retryability": {
        "$ref": "#/$defs/Retryability"
      },
      "mutationState": {
        "$ref": "#/$defs/MutationState"
      },
      "transactionRef": {
        "anyOf": [
          {
            "$ref": "#/$defs/Ref"
          },
          {
            "type": "null"
          }
        ]
      },
      "causeCode": {
        "anyOf": [
          {
            "$ref": "#/$defs/ErrorCode"
          },
          {
            "type": "null"
          }
        ]
      },
      "reason": {
        "$ref": "#/$defs/ErrorReason"
      },
      "worldRef": {
        "$ref": "#/$defs/Ref"
      },
      "source": {
        "$ref": "#/$defs/FailureSource"
      }
    },
    "required": [
      "code",
      "phase",
      "retryability",
      "mutationState",
      "transactionRef",
      "causeCode",
      "reason"
    ],
    "additionalProperties": false,
    "x-typeName": "Error"
  },
  "ErrorCode": {
    "enum": [
      "SCHEMA_INVALID",
      "NON_CANONICAL_AMBIGUITY",
      "UNSUPPORTED_VERSION",
      "UNKNOWN_REQUIRED_FIELD",
      "CAPABILITY_UNAVAILABLE",
      "INVALID_FRAME",
      "UNKNOWN_ACTION",
      "STALE_REVISION",
      "RENDERER_CAPABILITY_UNAVAILABLE",
      "ADAPTER_UNAVAILABLE",
      "CONNECTION_NOT_FOUND",
      "WORLD_NOT_FOUND",
      "PAYLOAD_VERSION_MISMATCH",
      "REPLAY_MISMATCH",
      "WORLD_NOT_BOUND",
      "OBJECT_NOT_FOUND",
      "OBJECT_SCOPE_MISMATCH",
      "INVALID_NAME",
      "OBJECT_NAME_CONFLICT",
      "INVALID_SELECTION",
      "DUPLICATE_OBJECT_REF",
      "INSPECTION_FAILED",
      "OTHER_OBJECTS_AFFECTED",
      "TRANSACTION_CONFLICT",
      "STALE_TRANSACTION",
      "APPLY_FAILED",
      "READBACK_FAILED",
      "READBACK_MISMATCH",
      "RESTORE_FAILED",
      "ROLLBACK_FAILED",
      "RECOVERY_PENDING",
      "UNDO_CONFLICT",
      "REDO_CONFLICT",
      "REDO_UNAVAILABLE",
      "SESSION_NOT_FOUND",
      "AMBIGUOUS_INTENT",
      "CROSS_WORLD_REFERENCE_AMBIGUOUS",
      "MODEL_UNAVAILABLE",
      "MODEL_REQUEST_FAILED",
      "ATTACHMENT_REJECTED",
      "SESSION_DELETE_UNSUPPORTED",
      "SAVED_RESOURCE_UNAVAILABLE",
      "RESOURCE_EXPIRED",
      "INTENT_UNCONFIRMED",
      "IMAGE_REQUIRED",
      "TARGET_REQUIRED",
      "TARGET_FACTS_STALE",
      "TARGET_FACTS_INCOMPLETE",
      "AMBIGUOUS_GEOMETRY",
      "UNSUPPORTED_MATERIAL",
      "BUILD_INVALID",
      "MEDIA_BINDING_INVALID",
      "MEDIA_DIGEST_MISMATCH",
      "TURN_REVISION_MISMATCH",
      "UNSUPPORTED_MEDIA_TYPE",
      "MEDIA_TOO_LARGE",
      "UNSUPPORTED_OPERATION",
      "CATALOGUE_MISMATCH",
      "SAFETY_INVARIANT_FAILED",
      "UNSUPPORTED_MUTATION_SEMANTICS",
      "LIMIT_EXCEEDED",
      "CURRENT_WORLD_MISMATCH",
      "REQUEST_CANCELLED",
      "REQUEST_NOT_ACTIVE",
      "CAPABILITY_GAP"
    ],
    "x-typeName": "ErrorCode"
  },
  "ErrorReason": {
    "enum": [
      "INVALID_UTF8",
      "DUPLICATE_DECODED_KEY",
      "LONE_SURROGATE",
      "INVALID_NUMBER",
      "INVALID_SHAPE",
      "UNKNOWN_FIELD",
      "VERSION_UNSUPPORTED",
      "IDENTITY_UNVERIFIED",
      "SCOPE_DENIED",
      "PAYLOAD_CHANGED",
      "REVISION_CHANGED",
      "INVALID_GEOMETRY",
      "CATALOGUE_UNRESOLVED",
      "REQUIRED_FACT_UNKNOWN",
      "POLICY_UNAVAILABLE",
      "LIMIT_EXCEEDED",
      "NAME_FORBIDDEN_CHARACTER",
      "NAME_INVISIBLE_OR_EMPTY",
      "NAME_KEY_EXISTS",
      "MEDIA_NOT_REFERENCED",
      "MEDIA_CORRUPT",
      "DELETE_SEAM_ABSENT",
      "RESOURCE_MISSING",
      "UNSUPPORTED_STATE_COVERAGE",
      "APPLY_ERROR",
      "READBACK_ERROR",
      "RESTORE_ERROR",
      "PERSIST_ERROR",
      "EXTERNAL_EDIT_CONFLICT",
      "TRANSPORT_OUTCOME_UNKNOWN",
      "OWNERSHIP_VIOLATION",
      "GEOMETRY_PROFILE_UNSUPPORTED"
    ],
    "x-typeName": "ErrorReason"
  },
  "FactsProviderIdentity": {
    "type": "object",
    "properties": {
      "providerRef": {
        "$ref": "#/$defs/Ref"
      },
      "providerRevision": {
        "$ref": "#/$defs/Ref"
      }
    },
    "required": [
      "providerRef",
      "providerRevision"
    ],
    "additionalProperties": false,
    "x-typeName": "FactsProviderIdentity"
  },
  "FailureSource": {
    "type": "object",
    "properties": {
      "owner": {
        "const": "world-source"
      },
      "operation": {
        "$ref": "#/$defs/Ref"
      },
      "resource": {
        "$ref": "#/$defs/Ref"
      },
      "kind": {
        "type": "string",
        "enum": [
          "INVALID_CONFIG",
          "NOT_FOUND",
          "PERMISSION",
          "IO",
          "CORRUPT",
          "VERSION",
          "LIMIT",
          "WAIT_EXPIRED",
          "UNSAFE_PATH"
        ]
      },
      "nativeCode": {
        "anyOf": [
          {
            "type": "string",
            "pattern": "^[A-Z0-9_]+$"
          },
          {
            "type": "null"
          }
        ]
      }
    },
    "required": [
      "owner",
      "operation",
      "resource",
      "kind",
      "nativeCode"
    ],
    "additionalProperties": false,
    "x-typeName": "FailureSource"
  },
  "FieldNames": {
    "type": "array",
    "items": {
      "$ref": "#/$defs/Ref"
    },
    "uniqueItems": true,
    "x-typeName": "FieldNames",
    "x-order": "UTF16 ascending"
  },
  "KnownAvatarEnvelope": {
    "x-typeName": "KnownAvatarEnvelope",
    "type": "object",
    "properties": {
      "availability": {
        "const": "KNOWN"
      },
      "basis": {
        "const": "WORLD_SOURCE_DECLARATION"
      },
      "size": {
        "$ref": "#/$defs/AvatarSize"
      }
    },
    "required": [
      "availability",
      "basis",
      "size"
    ],
    "additionalProperties": false
  },
  "KnownMaterialSource": {
    "x-typeName": "KnownMaterialSource",
    "type": "object",
    "properties": {
      "availability": {
        "const": "KNOWN"
      },
      "materialRef": {
        "$ref": "#/$defs/Ref"
      },
      "orientation": {
        "$ref": "#/$defs/Orientation"
      },
      "definitionRevision": {
        "$ref": "#/$defs/Revision"
      },
      "texture": {
        "$ref": "#/$defs/MaterialTextureSource"
      }
    },
    "required": [
      "availability",
      "materialRef",
      "orientation",
      "definitionRevision",
      "texture"
    ],
    "additionalProperties": false
  },
  "KnownWriteBackend": {
    "x-typeName": "KnownWriteBackend",
    "type": "object",
    "properties": {
      "availability": {
        "const": "KNOWN"
      },
      "basis": {
        "const": "LOADED_PAYLOAD_DECLARATION"
      },
      "writeBackend": {
        "$ref": "#/$defs/WriteBackendRef"
      }
    },
    "required": [
      "availability",
      "basis",
      "writeBackend"
    ],
    "additionalProperties": false
  },
  "MaterialPresentation": {
    "x-typeName": "MaterialPresentation",
    "type": "object",
    "properties": {
      "displayName": {
        "anyOf": [
          {
            "$ref": "#/$defs/Text"
          },
          {
            "type": "null"
          }
        ]
      },
      "color": {
        "anyOf": [
          {
            "$ref": "#/$defs/SrgbColor"
          },
          {
            "type": "null"
          }
        ]
      }
    },
    "required": [
      "displayName",
      "color"
    ],
    "additionalProperties": false,
    "x-meaning": "How the world source names and colours one material for people and for image material matching. null is unknown, never a default name or colour."
  },
  "MaterialPresentationMap": {
    "x-typeName": "MaterialPresentationMap",
    "type": "object",
    "propertyNames": {
      "$ref": "#/$defs/Ref"
    },
    "additionalProperties": {
      "$ref": "#/$defs/MaterialPresentation"
    },
    "x-meaning": "materialRef -> presentation."
  },
  "MaterialSource": {
    "x-typeName": "MaterialSource",
    "oneOf": [
      {
        "$ref": "#/$defs/KnownMaterialSource"
      },
      {
        "$ref": "#/$defs/UnknownMaterialSource"
      }
    ],
    "x-discriminator": "availability",
    "x-variantKeys": [
      "KNOWN",
      "UNKNOWN"
    ]
  },
  "MaterialSourceConnection": {
    "x-typeName": "MaterialSourceConnection",
    "type": "object",
    "properties": {
      "worldRef": {
        "$ref": "#/$defs/Ref"
      },
      "connectionRef": {
        "$ref": "#/$defs/Ref"
      },
      "connectionIncarnationRef": {
        "$ref": "#/$defs/Ref"
      }
    },
    "required": [
      "worldRef",
      "connectionRef",
      "connectionIncarnationRef"
    ],
    "additionalProperties": false
  },
  "MaterialSourceFacts": {
    "x-typeName": "MaterialSourceFacts",
    "type": "object",
    "properties": {
      "profileVersion": {
        "const": "material-source-facts/v1"
      },
      "snapshot": {
        "$ref": "#/$defs/MaterialSourcesSnapshot"
      },
      "presentation": {
        "$ref": "#/$defs/MaterialPresentationMap"
      }
    },
    "required": [
      "profileVersion",
      "snapshot",
      "presentation"
    ],
    "additionalProperties": false,
    "x-meaning": "Material sources and colours for image material selection. presentation has exactly the materialRefs of snapshot.materials as keys. Texture bytes are not on the wire: they are referenced by bytesDigest and travel through the in-process material sources port."
  },
  "MaterialSourceUnknownReason": {
    "x-typeName": "MaterialSourceUnknownReason",
    "enum": [
      "UNKNOWN_ORIENTATION",
      "UNKNOWN_DEFINITION",
      "MISSING_TEXTURE",
      "UNRESOLVED_SOURCE",
      "UNSUPPORTED_APPEARANCE"
    ]
  },
  "MaterialSourcesSnapshot": {
    "x-typeName": "MaterialSourcesSnapshot",
    "type": "object",
    "properties": {
      "profileVersion": {
        "const": "material-sources/v2"
      },
      "connection": {
        "$ref": "#/$defs/MaterialSourceConnection"
      },
      "catalogueDigest": {
        "$ref": "#/$defs/Digest"
      },
      "engineRevisions": {
        "$ref": "#/$defs/EngineRevisions"
      },
      "sourceBasis": {
        "const": "WORLD_SOURCE_ASSET_ONLY"
      },
      "materials": {
        "type": "array",
        "items": {
          "$ref": "#/$defs/MaterialSource"
        }
      },
      "sourceRevision": {
        "$ref": "#/$defs/Digest"
      }
    },
    "required": [
      "profileVersion",
      "connection",
      "catalogueDigest",
      "engineRevisions",
      "sourceBasis",
      "materials",
      "sourceRevision"
    ],
    "additionalProperties": false
  },
  "MaterialTagMap": {
    "type": "object",
    "propertyNames": {
      "$ref": "#/$defs/Ref"
    },
    "additionalProperties": {
      "$ref": "#/$defs/MaterialTags"
    },
    "x-typeName": "MaterialTagMap"
  },
  "MaterialTags": {
    "type": "object",
    "properties": {
      "passable": {
        "anyOf": [
          {
            "$ref": "#/$defs/Bool"
          },
          {
            "type": "null"
          }
        ]
      },
      "liquid": {
        "anyOf": [
          {
            "$ref": "#/$defs/Bool"
          },
          {
            "type": "null"
          }
        ]
      },
      "hazardPerSecond": {
        "anyOf": [
          {
            "$ref": "#/$defs/NonNegativeFinite"
          },
          {
            "type": "null"
          }
        ]
      },
      "emitsLight": {
        "anyOf": [
          {
            "$ref": "#/$defs/Bool"
          },
          {
            "type": "null"
          }
        ]
      },
      "placeable": {
        "anyOf": [
          {
            "$ref": "#/$defs/Bool"
          },
          {
            "type": "null"
          }
        ]
      },
      "orientations": {
        "anyOf": [
          {
            "$ref": "#/$defs/Orientations"
          },
          {
            "type": "null"
          }
        ]
      },
      "definitionRevision": {
        "anyOf": [
          {
            "$ref": "#/$defs/Revision"
          },
          {
            "type": "null"
          }
        ]
      },
      "unknownFields": {
        "$ref": "#/$defs/FieldNames"
      },
      "extension": {
        "$ref": "#/$defs/OpaqueMap"
      }
    },
    "required": [
      "passable",
      "liquid",
      "hazardPerSecond",
      "emitsLight",
      "placeable",
      "orientations",
      "definitionRevision",
      "unknownFields",
      "extension"
    ],
    "additionalProperties": false,
    "x-meaning": "Neutral tags the world source normalises from its own material definitions. placeable is the world source's conclusion that the material can be written and restored on its declared write path with no side effect and no persistent state; null is unknown and never treated as false or true. Raw engine fields stay in extension and are never read outside the world source.",
    "x-typeName": "MaterialTags"
  },
  "MaterialTextureSource": {
    "x-typeName": "MaterialTextureSource",
    "type": "object",
    "properties": {
      "textureName": {
        "$ref": "#/$defs/Ref"
      },
      "sourceKind": {
        "enum": [
          "GAME",
          "MOD"
        ]
      },
      "sourceRef": {
        "$ref": "#/$defs/Ref"
      },
      "interpretation": {
        "const": "SIMPLE_UNIFORM_NODE_TILES"
      },
      "mediaType": {
        "enum": [
          "image/png",
          "image/jpeg",
          "image/webp"
        ]
      },
      "bytesDigest": {
        "$ref": "#/$defs/Digest"
      },
      "byteLength": {
        "$ref": "#/$defs/PositiveInt"
      }
    },
    "required": [
      "textureName",
      "sourceKind",
      "sourceRef",
      "interpretation",
      "mediaType",
      "bytesDigest",
      "byteLength"
    ],
    "additionalProperties": false
  },
  "MutationState": {
    "enum": [
      "NONE",
      "VERIFIED",
      "ROLLED_BACK",
      "PARTIAL",
      "UNKNOWN"
    ],
    "x-typeName": "MutationState"
  },
  "NonNegativeFinite": {
    "type": "number",
    "minimum": 0,
    "x-typeName": "NonNegativeFinite",
    "x-finite": true
  },
  "OpaqueMap": {
    "x-typeName": "OpaqueMap",
    "type": "object",
    "propertyNames": {
      "$ref": "#/$defs/Ref"
    },
    "additionalProperties": {
      "$ref": "#/$defs/OpaqueValue"
    }
  },
  "OpaqueValue": {
    "x-typeName": "OpaqueValue",
    "x-opaque": true,
    "x-meaning": "Any strict JSON value owned by the world source. Carried and digested unchanged; never interpreted outside the world source."
  },
  "Orientation": {
    "x-typeName": "Orientation",
    "type": "integer",
    "minimum": 0,
    "maximum": 9007199254740991,
    "x-meaning": "Neutral orientation index of a material, from the set the Catalogue declares for that material. Conversion to an engine encoding happens only inside the world source."
  },
  "OrientationDescriptor": {
    "x-typeName": "OrientationDescriptor",
    "type": "object",
    "properties": {
      "orientation": {
        "$ref": "#/$defs/Orientation"
      },
      "quarterTurnsAboutUp": {
        "anyOf": [
          {
            "$ref": "#/$defs/QuarterTurns"
          },
          {
            "type": "null"
          }
        ]
      },
      "upsideDown": {
        "anyOf": [
          {
            "$ref": "#/$defs/Bool"
          },
          {
            "type": "null"
          }
        ]
      }
    },
    "required": [
      "orientation",
      "quarterTurnsAboutUp",
      "upsideDown"
    ],
    "additionalProperties": false,
    "x-meaning": "Neutral meaning of one orientation index: clockwise quarter turns about the Frame up axis seen from above, and whether the material is flipped upside down. null means the world source has no neutral expression for that part; the conversion to an engine encoding stays inside the world source."
  },
  "OrientationIndex": {
    "x-typeName": "OrientationIndex",
    "type": "array",
    "items": {
      "$ref": "#/$defs/OrientationDescriptor"
    },
    "x-uniqueBy": "orientation",
    "x-order": "orientation numeric ascending"
  },
  "Orientations": {
    "type": "array",
    "items": {
      "$ref": "#/$defs/Orientation"
    },
    "uniqueItems": true,
    "x-order": "numeric ascending",
    "x-typeName": "Orientations"
  },
  "Phase": {
    "enum": [
      "decode",
      "replay",
      "validate",
      "apply",
      "readback",
      "restore",
      "persist"
    ],
    "x-typeName": "Phase"
  },
  "PositiveFinite": {
    "type": "number",
    "exclusiveMinimum": 0,
    "x-typeName": "PositiveFinite",
    "x-finite": true
  },
  "PositiveInt": {
    "type": "integer",
    "minimum": 1,
    "maximum": 9007199254740991,
    "x-typeName": "PositiveInt"
  },
  "QuarterTurns": {
    "x-typeName": "QuarterTurns",
    "type": "integer",
    "minimum": 0,
    "maximum": 3
  },
  "ReadWriteProfileRequest": {
    "x-typeName": "ReadWriteProfileRequest",
    "type": "object",
    "properties": {
      "contractVersion": {
        "const": "world-facts/v1"
      },
      "requestId": {
        "$ref": "#/$defs/Ref"
      },
      "worldRef": {
        "$ref": "#/$defs/Ref"
      }
    },
    "required": [
      "contractVersion",
      "requestId",
      "worldRef"
    ],
    "additionalProperties": false
  },
  "ReadWriteProfileResponse": {
    "x-typeName": "ReadWriteProfileResponse",
    "type": "object",
    "properties": {
      "contractVersion": {
        "const": "world-facts/v1"
      },
      "requestId": {
        "$ref": "#/$defs/Ref"
      },
      "result": {
        "anyOf": [
          {
            "$ref": "#/$defs/WriteProfile"
          },
          {
            "type": "null"
          }
        ]
      },
      "error": {
        "anyOf": [
          {
            "$ref": "#/$defs/Error"
          },
          {
            "type": "null"
          }
        ]
      }
    },
    "required": [
      "contractVersion",
      "requestId",
      "result",
      "error"
    ],
    "additionalProperties": false
  },
  "Ref": {
    "type": "string",
    "minLength": 1,
    "x-typeName": "Ref",
    "x-normalization": "NONE; exact Unicode scalar sequence; never trim/lower/NFC; not a path"
  },
  "Retryability": {
    "enum": [
      "NEVER",
      "AFTER_NEW_FACTS",
      "SAME_TRANSACTION_QUERY",
      "AFTER_MANUAL_RECOVERY"
    ],
    "x-typeName": "Retryability"
  },
  "Revision": {
    "type": "string",
    "minLength": 1,
    "x-typeName": "Revision",
    "x-normalization": "NONE; opaque equality, never numeric ordering"
  },
  "SrgbColor": {
    "x-typeName": "SrgbColor",
    "type": "string",
    "pattern": "^#[0-9a-f]{6}$",
    "x-meaning": "An sRGB colour as lower-case #rrggbb. The world source decides how it is obtained (declared, or from its own assets); consumers compare and match colours only."
  },
  "Text": {
    "type": "string",
    "x-typeName": "Text",
    "x-normalization": "NONE"
  },
  "UnavailableWriteBackend": {
    "x-typeName": "UnavailableWriteBackend",
    "type": "object",
    "properties": {
      "availability": {
        "const": "UNAVAILABLE"
      },
      "reason": {
        "enum": [
          "NOT_DECLARED_BY_PAYLOAD",
          "ENGINE_FACT_UNREADABLE"
        ]
      }
    },
    "required": [
      "availability",
      "reason"
    ],
    "additionalProperties": false
  },
  "UnknownMaterialSource": {
    "x-typeName": "UnknownMaterialSource",
    "type": "object",
    "properties": {
      "availability": {
        "const": "UNKNOWN"
      },
      "materialRef": {
        "$ref": "#/$defs/Ref"
      },
      "orientation": {
        "anyOf": [
          {
            "$ref": "#/$defs/Orientation"
          },
          {
            "type": "null"
          }
        ]
      },
      "definitionRevision": {
        "anyOf": [
          {
            "$ref": "#/$defs/Revision"
          },
          {
            "type": "null"
          }
        ]
      },
      "texture": {
        "type": "null"
      },
      "reason": {
        "$ref": "#/$defs/MaterialSourceUnknownReason"
      }
    },
    "required": [
      "availability",
      "materialRef",
      "orientation",
      "definitionRevision",
      "texture",
      "reason"
    ],
    "additionalProperties": false
  },
  "WorldSourceTransportPolicy": {
    "type": "object",
    "properties": {
      "profileVersion": {
        "const": "world-source-transport-policy/v1"
      },
      "owner": {
        "const": "world-source"
      },
      "settings": {
        "type": "array",
        "minItems": 1,
        "items": {
          "$ref": "#/$defs/WorldSourceTransportSetting"
        }
      }
    },
    "required": [
      "profileVersion",
      "owner",
      "settings"
    ],
    "additionalProperties": false,
    "x-typeName": "WorldSourceTransportPolicy"
  },
  "WorldSourceTransportSetting": {
    "type": "object",
    "properties": {
      "name": {
        "$ref": "#/$defs/Ref"
      },
      "unit": {
        "enum": [
          "ms",
          "byte"
        ]
      },
      "defaultValue": {
        "type": "integer",
        "minimum": 0
      },
      "value": {
        "type": "integer",
        "minimum": 0
      },
      "min": {
        "type": "integer",
        "minimum": 0
      },
      "max": {
        "type": "integer",
        "minimum": 0
      },
      "editable": {
        "type": "boolean"
      },
      "meaning": {
        "$ref": "#/$defs/Ref"
      },
      "tradeoff": {
        "$ref": "#/$defs/Ref"
      },
      "validation": {
        "$ref": "#/$defs/Ref"
      }
    },
    "required": [
      "name",
      "unit",
      "defaultValue",
      "value",
      "min",
      "max",
      "editable",
      "meaning",
      "tradeoff",
      "validation"
    ],
    "additionalProperties": false,
    "x-typeName": "WorldSourceTransportSetting"
  },
  "WriteBackendFact": {
    "x-typeName": "WriteBackendFact",
    "oneOf": [
      {
        "$ref": "#/$defs/KnownWriteBackend"
      },
      {
        "$ref": "#/$defs/UnavailableWriteBackend"
      }
    ],
    "x-discriminator": "availability",
    "x-variantKeys": [
      "KNOWN",
      "UNAVAILABLE"
    ]
  },
  "WriteBackendRef": {
    "x-typeName": "WriteBackendRef",
    "type": "object",
    "properties": {
      "profileId": {
        "$ref": "#/$defs/Ref"
      },
      "revision": {
        "$ref": "#/$defs/Revision"
      }
    },
    "required": [
      "profileId",
      "revision"
    ],
    "additionalProperties": false,
    "x-meaning": "Opaque identity of the world source's write backend. Compared for equality only."
  },
  "WriteMethod": {
    "x-typeName": "WriteMethod",
    "enum": [
      "PER_CELL",
      "REGION"
    ]
  },
  "WriteMethods": {
    "x-typeName": "WriteMethods",
    "type": "array",
    "items": {
      "$ref": "#/$defs/WriteMethod"
    },
    "uniqueItems": true,
    "x-order": "WriteMethod enum order",
    "x-meaning": "The write methods the world source supports on the paired connection. A method not listed is not supported; nothing is implied by a package or wire version."
  },
  "WriteProfile": {
    "x-typeName": "WriteProfile",
    "type": "object",
    "properties": {
      "profileVersion": {
        "const": "write-profile/v1"
      },
      "connection": {
        "$ref": "#/$defs/MaterialSourceConnection"
      },
      "catalogueDigest": {
        "$ref": "#/$defs/Digest"
      },
      "writeBackend": {
        "$ref": "#/$defs/WriteBackendFact"
      },
      "compilationConfig": {
        "anyOf": [
          {
            "$ref": "#/$defs/CompilationConfig"
          },
          {
            "type": "null"
          }
        ]
      },
      "writeMethods": {
        "$ref": "#/$defs/WriteMethods"
      },
      "avatarEnvelope": {
        "$ref": "#/$defs/AvatarEnvelope"
      },
      "transportPolicy": {
        "$ref": "#/$defs/WorldSourceTransportPolicy"
      }
    },
    "required": [
      "profileVersion",
      "connection",
      "catalogueDigest",
      "writeBackend",
      "compilationConfig",
      "writeMethods",
      "avatarEnvelope"
    ],
    "additionalProperties": false,
    "x-meaning": "Everything a host needs to forward for writing: opaque write backend, the complete compilation configuration, supported write methods and the body envelope. compilationConfig is non-null exactly when writeBackend is KNOWN and then carries that writeBackend unchanged. A host forwards it as is: it never interprets, completes or defaults a field."
  }
} as const
