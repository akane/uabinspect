import { BigEndianByteReader, ByteReader } from "./ByteReader";
import { fetch_blob_range } from "./utils";

enum FileType {
  AssetsFile,
  BundleFile,
  WebFile,
  ResourceFile,
  GZipFile,
  BrotliFile,
  ZipFile
}

const gzipMagic = [0x1f, 0x8b];
const brotliMagic = [0x62, 0x72, 0x6F, 0x74, 0x6C, 0x69];
const zipMagic = [0x50, 0x4B, 0x03, 0x04];
const zipSpannedMagic = [0x50, 0x4B, 0x07, 0x08];

function is_serialized_file(reader: ByteReader, file_size: bigint) {
  if (reader.length < 20) {
    return false;
  }
  reader.seek(0);
  let m_MetadataSize = reader.u32();
  let m_FileSize = BigInt(reader.u32());
  const m_Version = BigInt(reader.u32());
  let m_DataOffset = BigInt(reader.u32());
  const m_Endianess = reader.u8();
  const m_Reserved = reader.bytes(3);
  if (m_Version >= 22) {
    if (reader.length < 48) return false;
    m_MetadataSize = reader.u32();
    m_FileSize = reader.u64();
    m_DataOffset = reader.u64();
  }
  if (m_FileSize !== file_size) return false;
  if (m_DataOffset > file_size) return false;
  return true;
}

export async function check_file_type(file: Blob) {
  const buffer = await fetch_blob_range(file, 0, Math.min(file.size, 0x30));
  const reader = new BigEndianByteReader(buffer);
  reader.seek(0);
  const signature = reader.c_str(20);
  const encoder = new TextEncoder();
  function s_match(s: string) {
    return encoder.encode(s).every((v, i) => signature[i] === v);
  }
  if (s_match('UnityWeb') || s_match('UnityRaw') || s_match('UnityFS')) {
    return FileType.BundleFile;
  }
  if (s_match('UnityWebData1.0')) {
    return FileType.WebFile;
  }
  function b_match(b: Uint8Array, magic: number[]) {
    return magic.every((v, i) => b[i] === v);
  }
  if (b_match(signature, gzipMagic)) {
    return FileType.GZipFile;
  }
  reader.seek(0x20);
  if (b_match(reader.bytes(6), brotliMagic)) {
    return FileType.BrotliFile;
  }
  if (is_serialized_file(reader, BigInt(file.size))) {
    return FileType.AssetsFile;
  }
  if (b_match(signature, zipMagic) || b_match(signature, zipSpannedMagic)) {
    return FileType.ZipFile;
  }
  return FileType.ResourceFile;
}
