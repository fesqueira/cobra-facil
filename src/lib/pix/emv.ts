/**
 * EMV MPM "TLV" encoding used by the BR Code: every field is
 * ID (2 digits) + LENGTH (2 digits) + VALUE.
 */

export interface EmvField {
  id: string;
  value: string;
}

export class EmvError extends Error {}

export function tlv(id: string, value: string): string {
  if (value.length > 99) throw new EmvError(`O campo ${id} passou de 99 caracteres (${value.length}).`);
  return `${id}${String(value.length).padStart(2, "0")}${value}`;
}

/** Parses a TLV string into fields. Throws EmvError when the structure is broken. */
export function parseTlv(input: string): EmvField[] {
  const fields: EmvField[] = [];
  let i = 0;
  while (i < input.length) {
    const id = input.slice(i, i + 2);
    const rawLength = input.slice(i + 2, i + 4);
    if (!/^\d{2}$/.test(id) || !/^\d{2}$/.test(rawLength)) throw new EmvError(`Estrutura inválida na posição ${i}.`);
    const length = Number(rawLength);
    const value = input.slice(i + 4, i + 4 + length);
    if (value.length !== length) throw new EmvError(`O campo ${id} termina antes do tamanho informado (${length}).`);
    fields.push({ id, value });
    i += 4 + length;
  }
  return fields;
}
