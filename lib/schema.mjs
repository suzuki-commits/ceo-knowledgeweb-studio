const text = { type: 'string' };
const sourced = {
  type: 'object', additionalProperties: false,
  required: ['title', 'body', 'sourceIds'],
  properties: { title: text, body: text, sourceIds: { type: 'array', items: text } }
};

export const modelOutputSchema = {
  type: 'object', additionalProperties: false,
  required: ['person', 'analysis', 'concepts', 'facts', 'pendingQuestions', 'proposal'],
  properties: {
    person: {
      type: 'object', additionalProperties: false,
      required: ['name', 'company', 'title', 'tagline', 'introduction', 'story', 'strengths', 'activities', 'media', 'speaking', 'community', 'vision', 'contactUrl'],
      properties: {
        name: text, company: text, title: text, tagline: text, introduction: text,
        story: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['year', 'title', 'body', 'sourceIds'], properties: { year: text, title: text, body: text, sourceIds: { type: 'array', items: text } } } },
        strengths: { type: 'array', items: sourced }, activities: { type: 'array', items: sourced }, media: { type: 'array', items: sourced }, speaking: { type: 'array', items: sourced }, community: { type: 'array', items: sourced },
        vision: text, contactUrl: text
      }
    },
    analysis: {
      type: 'object', additionalProperties: false,
      required: ['summary', 'characters', 'positioning', 'opportunities', 'audience', 'conflicts'],
      properties: {
        summary: text,
        characters: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'description', 'sourceIds'], properties: { name: text, description: text, sourceIds: { type: 'array', items: text } } } },
        positioning: { type: 'object', additionalProperties: false, required: ['entrance', 'proof', 'core'], properties: { entrance: text, proof: text, core: text } },
        opportunities: { type: 'array', items: sourced },
        audience: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['who', 'need', 'action'], properties: { who: text, need: text, action: text } } },
        conflicts: { type: 'array', items: text }
      }
    },
    concepts: {
      type: 'array', minItems: 5, maxItems: 5,
      items: { type: 'object', additionalProperties: false, required: ['id', 'name', 'label', 'headline', 'description', 'designIntent'], properties: { id: { type: 'string', enum: ['01', '02', '03', '04', '05'] }, name: text, label: text, headline: text, description: text, designIntent: text } }
    },
    facts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['claim', 'sourceIds'], properties: { claim: text, sourceIds: { type: 'array', minItems: 1, items: text } } } },
    pendingQuestions: { type: 'array', items: text },
    proposal: { type: 'object', additionalProperties: false, required: ['title', 'lead', 'recommendation', 'nextSteps'], properties: { title: text, lead: text, recommendation: text, nextSteps: { type: 'array', items: text } } }
  }
};

const obj = (v, path) => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${path} must be an object`); };
const str = (v, path) => { if (typeof v !== 'string') throw new Error(`${path} must be a string`); };
const arr = (v, path) => { if (!Array.isArray(v)) throw new Error(`${path} must be an array`); };
const sourcedArray = (items, path, sourceIds) => {
  arr(items, path);
  items.forEach((item, i) => {
    obj(item, `${path}[${i}]`); str(item.title, `${path}[${i}].title`); str(item.body, `${path}[${i}].body`);
    validateSourceIds(item.sourceIds, `${path}[${i}].sourceIds`, sourceIds);
  });
};
const validateSourceIds = (ids, path, known) => {
  arr(ids, path);
  ids.forEach((id, i) => { str(id, `${path}[${i}]`); if (!known.has(id)) throw new Error(`${path}[${i}] references unknown source ${id}`); });
};

export function validateBrief(brief) {
  obj(brief, 'brief'); obj(brief.person, 'person'); obj(brief.analysis, 'analysis'); obj(brief.proposal, 'proposal');
  arr(brief.sources, 'sources');
  const known = new Set();
  brief.sources.forEach((s, i) => { obj(s, `sources[${i}]`); ['id', 'type', 'label', 'url', 'retrievedAt', 'text'].forEach(k => str(s[k], `sources[${i}].${k}`)); if (known.has(s.id)) throw new Error(`duplicate source id ${s.id}`); known.add(s.id); });
  ['name','company','title','tagline','introduction','vision','contactUrl'].forEach(k => str(brief.person[k], `person.${k}`));
  arr(brief.person.story, 'person.story'); brief.person.story.forEach((x,i) => { obj(x, `person.story[${i}]`); ['year','title','body'].forEach(k => str(x[k], `person.story[${i}].${k}`)); validateSourceIds(x.sourceIds, `person.story[${i}].sourceIds`, known); });
  sourcedArray(brief.person.strengths, 'person.strengths', known); sourcedArray(brief.person.activities, 'person.activities', known); sourcedArray(brief.person.media, 'person.media', known); sourcedArray(brief.person.speaking, 'person.speaking', known); sourcedArray(brief.person.community, 'person.community', known);
  str(brief.analysis.summary, 'analysis.summary'); arr(brief.analysis.characters, 'analysis.characters'); brief.analysis.characters.forEach((x,i)=>{ obj(x,`analysis.characters[${i}]`); str(x.name,`analysis.characters[${i}].name`); str(x.description,`analysis.characters[${i}].description`); validateSourceIds(x.sourceIds,`analysis.characters[${i}].sourceIds`,known); });
  obj(brief.analysis.positioning,'analysis.positioning'); ['entrance','proof','core'].forEach(k=>str(brief.analysis.positioning[k],`analysis.positioning.${k}`));
  sourcedArray(brief.analysis.opportunities,'analysis.opportunities',known); arr(brief.analysis.audience,'analysis.audience'); brief.analysis.audience.forEach((x,i)=>['who','need','action'].forEach(k=>str(x?.[k],`analysis.audience[${i}].${k}`))); arr(brief.analysis.conflicts,'analysis.conflicts'); brief.analysis.conflicts.forEach((x,i)=>str(x,`analysis.conflicts[${i}]`));
  arr(brief.concepts,'concepts'); if (brief.concepts.length !== 5) throw new Error('concepts must contain exactly 5 items'); const expected=['01','02','03','04','05']; brief.concepts.forEach((x,i)=>{ obj(x,`concepts[${i}]`); if(x.id!==expected[i]) throw new Error(`concepts[${i}].id must be ${expected[i]}`); ['name','label','headline','description','designIntent'].forEach(k=>str(x[k],`concepts[${i}].${k}`)); });
  arr(brief.facts,'facts'); brief.facts.forEach((x,i)=>{obj(x,`facts[${i}]`);str(x.claim,`facts[${i}].claim`);validateSourceIds(x.sourceIds,`facts[${i}].sourceIds`,known);if(!x.sourceIds.length)throw new Error(`facts[${i}] requires a source`);});
  arr(brief.pendingQuestions,'pendingQuestions'); brief.pendingQuestions.forEach((x,i)=>str(x,`pendingQuestions[${i}]`));
  ['title','lead','recommendation'].forEach(k=>str(brief.proposal[k],`proposal.${k}`)); arr(brief.proposal.nextSteps,'proposal.nextSteps'); brief.proposal.nextSteps.forEach((x,i)=>str(x,`proposal.nextSteps[${i}]`));
  return brief;
}
