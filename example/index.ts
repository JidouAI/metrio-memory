import 'dotenv/config';
import { MemoryService } from '@metrio-ai/memory-service';

const TENANT = 'test';
const USER = 'LINE_USER_001';

async function main() {
  const memory = new MemoryService({
    databaseUrl: process.env.DATABASE_URL!,
    embedding: {
      provider: 'gemini',
      apiKey: process.env.GOOGLE_AI_API_KEY!,
    },
  });

  try {
    // ─── 1. Add tenant notes (org-level info) ───
    console.log('--- Adding tenant notes ---');

    await memory.tenants.notes.add(TENANT, {
      category: 'product',
      title: 'Basic Obedience Course',
      content: 'Price: NT$ 8,000 for 8 sessions. Suitable for dogs 6 months and older.',
      tags: ['course', 'pricing'],
    });

    await memory.tenants.notes.add(TENANT, {
      category: 'policy',
      title: 'Cancellation Policy',
      content: 'Full refund if cancelled 48 hours before class. 50% refund within 48 hours.',
      tags: ['policy', 'refund'],
    });

    console.log('Tenant notes added.\n');

    // ─── 2. Add user memories ───
    console.log('--- Adding user memories ---');

    await memory.addMemory({
      tenantSlug: TENANT,
      userExternalId: USER,
      content: 'User has a 2-year-old Shiba Inu named Mochi.',
      memoryType: 'fact',
      importance: 8,
    });

    await memory.addMemory({
      tenantSlug: TENANT,
      userExternalId: USER,
      content: 'User is interested in the Basic Obedience Course.',
      memoryType: 'preference',
      importance: 7,
    });

    await memory.addMemory({
      tenantSlug: TENANT,
      userExternalId: USER,
      content: 'User prefers Saturday afternoon classes.',
      memoryType: 'preference',
      importance: 6,
    });

    console.log('User memories added.\n');

    // ─── 3. Update user profile ───
    console.log('--- Updating user profile ---');

    await memory.updateProfileSummary({
      tenantSlug: TENANT,
      userExternalId: USER,
      summary: 'Dog owner with a 2-year-old Shiba Inu named Mochi. Interested in obedience training, prefers weekend classes.',
    });

    const profile = await memory.getProfileSummary(TENANT, USER);
    console.log('Profile:', profile?.summary, '\n');

    // ─── 4. Search memories ───
    console.log('--- Searching memories ---');

    const results = await memory.search({
      tenantSlug: TENANT,
      userExternalId: USER,
      query: 'what dog does the user have',
      limit: 3,
    });

    for (const r of results) {
      console.log(`  [${r.memoryType}] ${r.content} (similarity: ${r.similarity.toFixed(3)})`);
    }
    console.log();

    // ─── 5. Search tenant notes ───
    console.log('--- Searching tenant notes ---');

    const notes = await memory.tenants.notes.search(TENANT, {
      query: 'course pricing',
      limit: 3,
    });

    for (const n of notes) {
      console.log(`  [${n.category}] ${n.title}: ${n.content} (similarity: ${n.similarity.toFixed(3)})`);
    }
    console.log();

    // ─── 6. Get recent memories ───
    console.log('--- Recent memories ---');

    const recent = await memory.getRecentMemories(TENANT, USER, { limit: 5 });

    for (const m of recent) {
      console.log(`  [${m.memoryType}] ${m.content}`);
    }
    console.log();

    // ─── 7. Get full context (for LLM system prompt) ───
    console.log('--- Full context ---');

    const context = await memory.getContext(TENANT, USER, {
      recentLimit: 3,
      includeOrgNotes: true,
      orgNoteCategories: ['product', 'policy'],
      includeOrgMemories: true,
    });

    console.log(context.formatted);
  } finally {
    await memory.close();
  }
}

main().catch(console.error);
