#!/usr/bin/env node
// House of Figs MCP server — exposes the Firestore data behind the site
// (quiz leads, intakes, assessments, plans, Going Deeper, posts, testimonials)
// to any MCP client over stdio.
//
// Read-only by default. Set HOF_MCP_ALLOW_WRITES=true to enable write tools —
// note that writes to intakes/assessments/plans can fire the Cloud Function
// email triggers in ../functions, which send real email to admins and clients.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';

const PROJECT_ID = process.env.HOF_FIREBASE_PROJECT || 'houseoffigs-16f71';
const ALLOW_WRITES = process.env.HOF_MCP_ALLOW_WRITES === 'true';

const COLLECTIONS = {
  quizzes: 'Rooted quiz sessions — answers, computed profile, captured email, follow-up email state',
  intakes: 'Full intake submissions — the start of the client journey',
  assessments: 'Generated assessments keyed by intake id, with approval/hold state',
  plans: '30-day plans keyed by intake id, with approval state',
  goingDeeper: 'Going Deeper responses keyed by intake id',
  leadMeta: 'Per-lead metadata (source flags, admin notes)',
  posts: 'Blog posts',
  testimonials: 'Client testimonials',
};

let db = null;
function firestore() {
  if (!db) {
    const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    const credential = keyPath
      ? cert(JSON.parse(readFileSync(keyPath, 'utf8')))
      : applicationDefault();
    initializeApp({ credential, projectId: PROJECT_ID });
    db = getFirestore();
  }
  return db;
}

// Firestore Timestamps/refs aren't JSON-friendly; flatten them for the model.
function serialize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value.constructor && value.constructor.name === 'DocumentReference') return value.path;
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = serialize(v);
  return out;
}

function docJson(snap) {
  return { id: snap.id, ...serialize(snap.data()) };
}

function ok(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function fail(message) {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

const collectionParam = z.enum(Object.keys(COLLECTIONS));

const server = new McpServer({ name: 'house-of-figs', version: '1.0.0' });

server.registerTool(
  'list_collections',
  {
    title: 'List collections',
    description: 'List the House of Figs Firestore collections this server exposes, with a description of each.',
  },
  async () => ok(COLLECTIONS)
);

server.registerTool(
  'query_documents',
  {
    title: 'Query documents',
    description:
      'Query a collection with optional field filters, ordering, and limit. Filters use Firestore operators (==, !=, <, <=, >, >=, array-contains, in). Returns full documents.',
    inputSchema: {
      collection: collectionParam,
      where: z
        .array(z.object({ field: z.string(), op: z.string(), value: z.any() }))
        .optional()
        .describe('Filters, e.g. [{"field":"status","op":"==","value":"approved"}]'),
      order_by: z.string().optional().describe('Field to sort by'),
      direction: z.enum(['asc', 'desc']).optional(),
      limit: z.number().int().min(1).max(200).optional().describe('Max documents (default 25)'),
    },
  },
  async ({ collection, where, order_by, direction, limit }) => {
    try {
      let q = firestore().collection(collection);
      for (const f of where || []) q = q.where(f.field, f.op, f.value);
      if (order_by) q = q.orderBy(order_by, direction || 'desc');
      const snap = await q.limit(limit || 25).get();
      return ok({ count: snap.size, documents: snap.docs.map(docJson) });
    } catch (e) {
      return fail(e.message);
    }
  }
);

server.registerTool(
  'get_document',
  {
    title: 'Get document',
    description: 'Fetch a single document by collection and id.',
    inputSchema: { collection: collectionParam, id: z.string() },
  },
  async ({ collection, id }) => {
    try {
      const snap = await firestore().collection(collection).doc(id).get();
      if (!snap.exists) return fail(`No document ${collection}/${id}`);
      return ok(docJson(snap));
    } catch (e) {
      return fail(e.message);
    }
  }
);

server.registerTool(
  'search_by_email',
  {
    title: 'Search by email',
    description: 'Find quiz sessions and intakes matching an email address (case-insensitive exact match).',
    inputSchema: { email: z.string() },
  },
  async ({ email }) => {
    try {
      const needle = email.trim().toLowerCase();
      const results = {};
      for (const coll of ['quizzes', 'intakes']) {
        const snap = await firestore().collection(coll).get();
        results[coll] = snap.docs
          .filter((d) => {
            const data = d.data();
            const em = data.email || data.contact?.email || '';
            return String(em).trim().toLowerCase() === needle;
          })
          .map(docJson);
      }
      return ok(results);
    } catch (e) {
      return fail(e.message);
    }
  }
);

server.registerTool(
  'get_client_journey',
  {
    title: 'Get client journey',
    description:
      'Fetch everything for one client by intake id: the intake plus the assessment, 30-day plan, Going Deeper responses, and lead metadata keyed to it.',
    inputSchema: { intake_id: z.string() },
  },
  async ({ intake_id }) => {
    try {
      const fs = firestore();
      const [intake, assessment, plan, goingDeeper, leadMeta] = await Promise.all(
        ['intakes', 'assessments', 'plans', 'goingDeeper', 'leadMeta'].map((c) =>
          fs.collection(c).doc(intake_id).get()
        )
      );
      if (!intake.exists) return fail(`No intake ${intake_id}`);
      return ok({
        intake: docJson(intake),
        assessment: assessment.exists ? docJson(assessment) : null,
        plan: plan.exists ? docJson(plan) : null,
        goingDeeper: goingDeeper.exists ? docJson(goingDeeper) : null,
        leadMeta: leadMeta.exists ? docJson(leadMeta) : null,
      });
    } catch (e) {
      return fail(e.message);
    }
  }
);

server.registerTool(
  'pipeline_summary',
  {
    title: 'Pipeline summary',
    description:
      'Counts across the client pipeline: total quiz sessions (and how many captured an email), intakes, and assessments/plans grouped by status.',
  },
  async () => {
    try {
      const fs = firestore();
      const [quizzes, intakes, assessments, plans] = await Promise.all(
        ['quizzes', 'intakes', 'assessments', 'plans'].map((c) => fs.collection(c).get())
      );
      const byStatus = (snap) => {
        const counts = {};
        snap.docs.forEach((d) => {
          const s = d.data().status || '(none)';
          counts[s] = (counts[s] || 0) + 1;
        });
        return counts;
      };
      return ok({
        quizzes: {
          total: quizzes.size,
          withEmail: quizzes.docs.filter((d) => d.data().email).length,
        },
        intakes: { total: intakes.size, byStatus: byStatus(intakes) },
        assessments: { total: assessments.size, byStatus: byStatus(assessments) },
        plans: { total: plans.size, byStatus: byStatus(plans) },
      });
    } catch (e) {
      return fail(e.message);
    }
  }
);

if (ALLOW_WRITES) {
  server.registerTool(
    'update_document',
    {
      title: 'Update document',
      description:
        'Merge fields into an existing document. WARNING: updates to quizzes, intakes, assessments, or plans can fire Cloud Function triggers that send real email to admins and clients.',
      inputSchema: {
        collection: collectionParam,
        id: z.string(),
        fields: z.record(z.string(), z.any()).describe('Fields to merge into the document'),
      },
    },
    async ({ collection, id, fields }) => {
      try {
        const ref = firestore().collection(collection).doc(id);
        if (!(await ref.get()).exists) return fail(`No document ${collection}/${id}`);
        await ref.set(fields, { merge: true });
        return ok({ updated: `${collection}/${id}`, fields: Object.keys(fields) });
      } catch (e) {
        return fail(e.message);
      }
    }
  );

  server.registerTool(
    'create_document',
    {
      title: 'Create document',
      description:
        'Create a new document. WARNING: creating intakes or goingDeeper docs fires Cloud Function triggers that send real email.',
      inputSchema: {
        collection: collectionParam,
        id: z.string().optional().describe('Document id; omit to auto-generate'),
        fields: z.record(z.string(), z.any()),
      },
    },
    async ({ collection, id, fields }) => {
      try {
        const coll = firestore().collection(collection);
        const ref = id ? coll.doc(id) : coll.doc();
        if (id && (await ref.get()).exists) return fail(`${collection}/${id} already exists`);
        await ref.set(fields);
        return ok({ created: `${collection}/${ref.id}` });
      } catch (e) {
        return fail(e.message);
      }
    }
  );
}

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(
  `House of Figs MCP server running (project ${PROJECT_ID}, writes ${ALLOW_WRITES ? 'ENABLED' : 'disabled'})`
);
