import { BigEndianByteReader, ByteReader, LittleEndianByteReader } from "./ByteReader";
import { fetch_blob_chunk, fetch_blob_range, parser_assert, range } from "./utils";
import { FormatVersion } from "./FormatVersion";
import { BuildTarget } from "./BuildTarget";
import { ClassID } from "./ClassIDType";
import { common_strings } from "./CommonString";

function read_bool(reader: ByteReader) {
  const v = reader.u8();
  parser_assert(v === 1, reader, `Expected boolean, found ${v}`);
  return v === 1;
}

export async function parse_file(blob: Blob) {
  let chunk = await fetch_blob_chunk(blob, 0);
  let reader: ByteReader = new BigEndianByteReader(chunk);
  let m_MetadataSize = reader.u32(); // TODO: get the exact meaning of this size

  let m_FileSize = reader.u32();
  let m_Version = reader.u32();
  parser_assert(Object.hasOwn(FormatVersion, m_Version), reader, `Unsupported version ${m_Version}`);
  let m_DataOffset = reader.u32();
  let m_Endianess: number;
  let m_Reserved: ArrayBuffer;
  if (m_Version >= FormatVersion.Unknown_9) {
    m_Endianess = reader.u8();
    m_Reserved = reader.bytes(3);
  } else {
    parser_assert(m_FileSize === blob.size, reader);
    parser_assert(m_MetadataSize <= blob.size, reader);
    chunk = await fetch_blob_range(blob, blob.size - m_MetadataSize, blob.size);
    reader.seek(Number(m_FileSize) - m_MetadataSize);
    m_Endianess = reader.u8();
  }

  if (m_Version >= FormatVersion.LargeFilesSupport) {
    m_MetadataSize = reader.u32();
    m_FileSize = Number(reader.i64());
    m_DataOffset = Number(reader.i64());
    reader.i64(); // unknown
  }
  parser_assert(m_FileSize === blob.size, reader);
  parser_assert(m_MetadataSize <= blob.size, reader);

  // Read the metadata
  if (m_Endianess === 0) {
    const prev_pos = reader.tell();
    reader = new LittleEndianByteReader(chunk);
    reader.seek(prev_pos);
  }
  let unity_version: number[] | "0.0.0" = "0.0.0";
  let build_type: string | null = null;
  if (m_Version >= FormatVersion.Unknown_7) {
    const decoder = new TextDecoder();
    const version = decoder.decode(reader.c_str(Number(m_FileSize)));
    if (version !== unity_version) {
      const parts = version.split('.');
      unity_version = [];
      for (const part of parts) {
        if (/^\d*$/.test(part)) {
          unity_version.push(Number(part));
        } else {
          parser_assert(build_type === null, reader, `Expected to have only one build string, got ${version}`);
          build_type = part;
        }
      }
    }
  }
  let m_TargetPlatform: BuildTarget;
  if (m_Version >= FormatVersion.Unknown_8) {
    m_TargetPlatform = reader.i32();
    if (!Object.hasOwn(BuildTarget, m_TargetPlatform)) {
      console.warn(`Unknown target platform ${m_TargetPlatform}`);
      m_TargetPlatform = BuildTarget.UnknownPlatform;
    }
  }
  let m_EnableTypeTree = false;
  if (m_Version >= FormatVersion.HasTypeTreeHashes) {
    m_EnableTypeTree = read_bool(reader);
  }

  // Read the types
  const type_count = reader.i32();
  const m_Types = [];
  for (let i = 0; i < type_count; i++) {
    m_Types.push(parse_type(reader, {
      is_ref: false,
      m_EnableTypeTree,
      m_Version,
    }));
  }
}

function parse_type(reader: ByteReader, { is_ref, m_EnableTypeTree, m_Version }: {
  is_ref: boolean,
  m_EnableTypeTree: boolean,
  m_Version: FormatVersion,
}) {
  const class_id: ClassID = reader.i32();
  let m_IsStrippedType = false;
  if (m_Version >= FormatVersion.RefactoredClassId) {
    m_IsStrippedType = reader.u8() === 1;
  }
  let m_ScriptTypeIndex = null;
  if (m_Version >= FormatVersion.RefactorTypeData) {
    m_ScriptTypeIndex = reader.i16();
  }
  let m_ScriptID: ArrayBuffer | null = null;
  let m_OldTypeHash: ArrayBuffer | null = null;
  if (m_Version >= FormatVersion.HasTypeTreeHashes) {
    if (is_ref && m_ScriptTypeIndex !== null && m_ScriptTypeIndex >= 0) {
      m_ScriptID = reader.bytes(16);
    } else if ((m_Version < FormatVersion.RefactoredClassId && class_id < 0)
      || (m_Version >= FormatVersion.RefactoredClassId && class_id === ClassID.MonoBehaviour)) {
      m_ScriptID = reader.bytes(16);
    }
    m_OldTypeHash = reader.bytes(16);
  }

  let m_Nodes: TypeTreeNode[] = [];
  let m_ClassName: string | null = null;
  let m_NameSpace: string | null = null;
  let m_AsmName: string | null = null;
  let m_TypeDependencies: number[] = [];
  if (m_EnableTypeTree) {
    if (m_Version >= FormatVersion.Unknown_12 || m_Version === FormatVersion.Unknown_10) {
      m_Nodes = TypeTreeBlobRead(reader, m_Version);
    } else {
      ReadTypeTree(m_Nodes, reader, 0, m_Version);
    }
    if (m_Version >= FormatVersion.StoresTypeDependencies) {
      if (is_ref) {
        const decoder = new TextDecoder();
        m_ClassName = decoder.decode(reader.c_str(reader.length));
        m_NameSpace = decoder.decode(reader.c_str(reader.length));
        m_AsmName = decoder.decode(reader.c_str(reader.length));
      } else {
        const count = reader.i32();
        for (let i = 0; i < count; i++) {
          m_TypeDependencies.push(reader.i32());
        }
      }
    }
  }

  return {
    class_id,
    m_IsStrippedType,
    m_ScriptTypeIndex,
    m_Nodes,
    m_ScriptID,
    m_OldTypeHash,
    m_TypeDependencies,
    m_ClassName,
    m_NameSpace,
    m_AsmName,
  };
}

type TypeTreeNode = {
  m_Version: number,
  m_Index?: number,
  m_MetaFlag?: number,
  m_Type: string,
  m_Name: string,
  m_ByteSize: number,
  m_TypeFlags: number,
  m_Level: number,
  m_TypeStrOffset?: number,
  m_NameStrOffset?: number,
  m_RefTypeHash?: bigint,
};

function TypeTreeBlobRead(reader: ByteReader, m_Version: FormatVersion) {
  const node_count = reader.i32();
  const string_buffer_size = reader.i32();
  const m_Nodes = range(node_count).map(() => {
    const node = {
      m_Version: reader.u16(),
      m_Level: reader.u8(),
      m_TypeFlags: reader.u8(),
      m_TypeStrOffset: reader.u32(),
      m_NameStrOffset: reader.u32(),
      m_ByteSize: reader.i32(),
      m_Index: reader.i32(),
      m_MetaFlag: reader.i32(),
      m_RefTypeHash: BigInt(0),
    };
    if (m_Version >= FormatVersion.TypeTreeNodeWithTypeFlags) {
      node.m_RefTypeHash = reader.u64();
    }
    return node;
  });
  const m_StringBuffer = reader.bytes(string_buffer_size);
  const string_reader = new BigEndianByteReader(m_StringBuffer);

  function read_string(value: number) {
    const is_offset = (value & 0x80000000) === 0;
    if (is_offset) {
      string_reader.seek(value);
      const decoder = new TextDecoder();
      return decoder.decode(string_reader.c_str(string_reader.length));
    }
    const offset = value & 0x7FFFFFFF;
    return common_strings.get(offset) ?? offset.toString();
  }

  return m_Nodes.map(node => ({
    ...node,
    m_Type: read_string(node.m_TypeStrOffset),
    m_Name: read_string(node.m_NameStrOffset),
  }));
}

function ReadTypeTree(nodes: TypeTreeNode[], reader: ByteReader, m_Level: number, m_Version: FormatVersion) {
  const decoder = new TextDecoder();
  const node1 = {
    m_Level,
    m_Type: decoder.decode(reader.c_str(reader.length)),
    m_Name: decoder.decode(reader.c_str(reader.length)),
    m_ByteSize: reader.i32(),
  };
  if (m_Version === FormatVersion.Unknown_2) {
    const variable_count = reader.i32();
  }
  let m_Index = undefined;
  if (m_Version !== FormatVersion.Unknown_3) {
    m_Index = reader.i32();
  }
  const node2 = {
    m_TypeFlags: reader.i32(),
    m_Version: reader.i32(),
  };
  let m_MetaFlag = undefined;
  if (m_Version !== FormatVersion.Unknown_3) {
    m_MetaFlag = reader.i32();
  }
  nodes.push({
    ...node1,
    ...node2,
    m_Index,
    m_MetaFlag,
  })
  range(reader.i32()).map(() => ReadTypeTree(nodes, reader, m_Level + 1, m_Version));
}
