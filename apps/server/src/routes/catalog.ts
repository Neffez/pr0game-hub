import {
  CLASS_BUILDINGS,
  CLASS_DEFENSE,
  CLASS_FLEET,
  CLASS_RESEARCH,
  CLASS_RESOURCES,
  ELEMENT_COSTS,
  TECH_NAMES,
} from '@pr0hub/core/tech';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth.js';

export function catalogRoutes(app: FastifyInstance) {
  /** Game element names and build costs (not player data). */
  app.get('/api/catalog', async (req) => {
    requireUser(req);
    return {
      names: TECH_NAMES,
      costs: ELEMENT_COSTS,
      classes: {
        buildings: CLASS_BUILDINGS,
        research: CLASS_RESEARCH,
        fleet: CLASS_FLEET,
        defense: CLASS_DEFENSE,
        resources: CLASS_RESOURCES,
      },
    };
  });
}
