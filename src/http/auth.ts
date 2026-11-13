import type { FastifyRequest } from "fastify";
import type { Sql } from "../db/client.js";
import { safeEqual, sha256 } from "../lib/crypto.js";
import { AppError } from "../lib/errors.js";
import { findMerchantByApiKeyHash, type Merchant } from "../modules/merchants/repository.js";

declare module "fastify" {
  interface FastifyRequest {
    merchant: Merchant | null;
  }
}

/** Hook that resolves `Authorization: Bearer <api key>` into request.merchant. Only the key's hash is stored. */
export function merchantAuth(sql: Sql) {
  return async (req: FastifyRequest) => {
    const match = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "");
    if (!match?.[1]) {
      throw new AppError(401, "UNAUTHORIZED", "Envie a chave de API no cabeçalho Authorization: Bearer <chave>.");
    }
    const merchant = await findMerchantByApiKeyHash(sql, sha256(match[1]));
    if (!merchant) throw new AppError(401, "UNAUTHORIZED", "Chave de API inválida.");
    req.merchant = merchant;
  };
}

export function adminAuth(adminToken: string) {
  return async (req: FastifyRequest) => {
    const token = req.headers["x-admin-token"];
    if (typeof token !== "string" || !safeEqual(token, adminToken)) {
      throw new AppError(401, "UNAUTHORIZED", "Token de administrador inválido.");
    }
  };
}

/** For handlers behind merchantAuth. */
export function currentMerchant(req: FastifyRequest): Merchant {
  if (!req.merchant) throw new AppError(401, "UNAUTHORIZED", "Não autenticado.");
  return req.merchant;
}
