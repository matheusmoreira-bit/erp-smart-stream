import { z } from 'zod';

export const accessStatusSchema = z.object({
  enabled: z.boolean(), admitted: z.boolean(), manager: z.boolean(),
  version: z.number(), ready: z.boolean(),
  coverage_note: z.string().optional(), updated_at: z.string().optional(),
  users: z.array(z.object({ id: z.string().uuid(), email: z.string().email(), manager: z.boolean() })).optional(),
});
export type ErpAccessStatus = z.infer<typeof accessStatusSchema>;