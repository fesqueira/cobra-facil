import { z } from "zod";

export const CHARGE_STATUSES = ["pending", "paid", "canceled", "expired"] as const;
export type ChargeStatus = (typeof CHARGE_STATUSES)[number];

export interface ChargeRow {
  id: string;
  merchantId: string;
  txid: string;
  amountCents: number;
  description: string | null;
  status: ChargeStatus;
  pixCopyPaste: string;
  expiresAt: Date;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export const chargeSchema = z
  .object({
    id: z.uuid(),
    txid: z.string().meta({ description: "Identificador da transação no BR Code (25 letras e números)." }),
    status: z.enum(CHARGE_STATUSES),
    amountCents: z.int().meta({ description: "Valor em centavos.", example: 2590 }),
    description: z.string().nullable(),
    pixCopyPaste: z.string().meta({ description: "Código Pix Copia e Cola (BR Code estático com CRC16)." }),
    expiresAt: z.string(),
    paidAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .meta({ id: "Charge" });

export type ChargeDto = z.infer<typeof chargeSchema>;

/** The public shape of a charge, used by the API and by webhook payloads. */
export const toChargeDto = (c: ChargeRow): ChargeDto => ({
  id: c.id,
  txid: c.txid,
  status: c.status,
  amountCents: c.amountCents,
  description: c.description,
  pixCopyPaste: c.pixCopyPaste,
  expiresAt: c.expiresAt.toISOString(),
  paidAt: c.paidAt?.toISOString() ?? null,
  createdAt: c.createdAt.toISOString(),
});
