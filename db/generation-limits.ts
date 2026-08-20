import { env } from "cloudflare:workers";
import type { GenerationLimitRecord, GenerationLimitStore } from "../lib/generation-service.ts";

interface GenerationLimitRow {
  requestId: string;
  lastStartedAt: number;
  leaseExpiresAt: number;
}

function database() {
  if (!env.DB) throw new Error("D1 binding unavailable");
  return env.DB;
}

export function getGenerationLimitStore(): GenerationLimitStore {
  return {
    async tryAcquire(ownerId, requestId, startedAt, leaseExpiresAt, cooldownCutoff) {
      const row = await database().prepare(`
        INSERT INTO generation_limits
          (owner_id, request_id, last_started_at, lease_expires_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(owner_id) DO UPDATE SET
          request_id = excluded.request_id,
          last_started_at = excluded.last_started_at,
          lease_expires_at = excluded.lease_expires_at
        WHERE generation_limits.lease_expires_at <= ?
          AND generation_limits.last_started_at <= ?
        RETURNING owner_id
      `).bind(
        ownerId,
        requestId,
        startedAt,
        leaseExpiresAt,
        startedAt,
        cooldownCutoff,
      ).first<{ ownerId: string }>();
      return Boolean(row);
    },

    async get(ownerId) {
      const row = await database().prepare(`
        SELECT request_id AS requestId,
               last_started_at AS lastStartedAt,
               lease_expires_at AS leaseExpiresAt
        FROM generation_limits
        WHERE owner_id = ?
        LIMIT 1
      `).bind(ownerId).first<GenerationLimitRow>();
      return row ? {
        requestId: row.requestId,
        lastStartedAt: Number(row.lastStartedAt),
        leaseExpiresAt: Number(row.leaseExpiresAt),
      } satisfies GenerationLimitRecord : null;
    },

    async release(ownerId, requestId, finishedAt) {
      await database().prepare(`
        UPDATE generation_limits
        SET lease_expires_at = ?
        WHERE owner_id = ? AND request_id = ?
      `).bind(finishedAt, ownerId, requestId).run();
    },
  };
}
