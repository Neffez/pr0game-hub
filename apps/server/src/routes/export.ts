import type { FastifyInstance } from 'fastify';
import { HttpError } from '../auth.js';
import type { DB } from '../db.js';
import { DATASETS, EXPORT_DAYS, exportAll, exportTable, MAX_EXPORT_DAYS, toCsv, type Dataset } from '../repo/export.js';
import { contextOf } from './util.js';

/** Export of the group's data: all of it as JSON, one table as CSV (attachments; GET, so read-only tokens work). */
export function exportRoutes(app: FastifyInstance, db: DB) {
  const ctxOf = contextOf(db);
  const sinceOf = (days: unknown, now: number) => {
    const d = days == null || days === '' ? EXPORT_DAYS : Number(days);
    if (!Number.isInteger(d) || d < 1 || d > MAX_EXPORT_DAYS) throw new HttpError(400, 'export_invalid', `days: 1-${MAX_EXPORT_DAYS}`);
    return now - d * 86400;
  };

  app.get<{ Params: { uni: string }; Querystring: { days?: string } }>('/api/:uni/export', async (req, reply) => {
    const ctx = ctxOf(req);
    const body = exportAll(db, ctx, sinceOf(req.query.days, ctx.now));
    return reply
      .header('content-type', 'application/json; charset=utf-8')
      .header('content-disposition', `attachment; filename="${ctx.universe.slug}-export.json"`)
      .send(JSON.stringify(body));
  });

  app.get<{ Params: { uni: string; dataset: string }; Querystring: { days?: string; sep?: string } }>('/api/:uni/export/:dataset', async (req, reply) => {
    const ctx = ctxOf(req);
    const name = req.params.dataset.replace(/\.csv$/, '');
    if (!DATASETS.includes(name as Dataset)) throw new HttpError(404, 'export_unknown', `Datasets: ${DATASETS.join(', ')}`);
    const sep = req.query.sep === 'semicolon' ? ';' : req.query.sep === 'tab' ? '\t' : ',';
    const csv = toCsv(exportTable(db, ctx, name as Dataset, sinceOf(req.query.days, ctx.now)), sep);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${ctx.universe.slug}-${name}.csv"`)
      // BOM: spreadsheet programs read the file as UTF-8
      .send('﻿' + csv);
  });
}
