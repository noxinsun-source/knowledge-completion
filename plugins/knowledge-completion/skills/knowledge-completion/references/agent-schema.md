# Knowledge Completion Agent schema

## Draft contract

```json
{
  "scope": "Goal-relative map boundary",
  "scopeDescription": "What is inside and outside this map",
  "concepts": [
    {
      "name": "Canonical concept name",
      "aliases": ["Alias"],
      "semanticType": "concept",
      "granularity": 3,
      "description": "Definition",
      "whyItMatters": "Connection to the goal",
      "parentNames": ["Parent concept"],
      "evidence": [{"sourceNoteId": "note_1", "excerpt": "Exact source excerpt", "confidence": 0.9}],
      "confidence": 0.9,
      "expandable": true
    }
  ],
  "relations": [{
    "sourceName": "Source concept",
    "targetName": "Target concept",
    "relation": "prerequisite",
    "statement": "Human-readable relation",
    "evidence": [],
    "confidence": 0.7
  }]
}
```

Semantic types are `domain`, `topic`, `concept`, `mechanism`, `method`, `tool`, `formula`, and `example`.

Granularity is goal-relative: `1` scope/field, `2` topic/module, `3` learnable concept, `4` mechanism/method, and `5` formula/implementation/measurement/example.

Relation direction:

- `part_of`: source is a component of target.
- `contains`: source contains target.
- `prerequisite`: source should be learned before target.
- `enables`: source enables or affects target.
- `applied_in`: source is applied in target.
- `contrasts_with`: source contrasts with target.
- `related_to`: evidence supports adjacency but the precise relation is unclear.

Evidence rules:

- The first `--note` input is `note_1`, the second is `note_2`, and `--text` or `--stdin` receives the next number after all file inputs. Drafts must use this exact positional mapping.
- A note-backed excerpt must occur verbatim in the input note.
- A model proposal without a source must use `evidence: []`.
- Do not treat model confidence as source authority.
- Keep uncertain concepts as boundary nodes for review.
- Do not mark a concept understood merely because a note mentions or saves it.
