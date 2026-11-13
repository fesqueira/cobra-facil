/**
 * CRC16/CCITT-FALSE (polynomial 0x1021, initial value 0xFFFF), the checksum
 * required by the BR Code specification for field 63.
 *
 * The CRC is calculated over the whole payload, including the "6304" tag and
 * length of field 63 itself, and is written as 4 uppercase hex digits.
 */
export function crc16(payload: string): string {
  let crc = 0xffff;

  for (const byte of new TextEncoder().encode(payload)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }

  return crc.toString(16).toUpperCase().padStart(4, "0");
}
