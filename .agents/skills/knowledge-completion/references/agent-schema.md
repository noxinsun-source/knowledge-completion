# Knowledge Completion Agent schema

## Draft contract

Codex or another model may author this JSON and pass it through `--draft`:

```json
{
  "scope": "Goal-relative map boundary",
  "scopeDescription": "What is inside and outside this map",
  "concepts": [
    {
      "name": "Canonical concept name",
      "aliases": ["Alias"],
      "semanticType": "domain",
      "granularity": 1,
      "description": "Definition",
      "whyItMatters": "Connection to the goal",
      "parentNames": [],
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

Allowed semantic types:

- `domain`: goal-relative root
- `topic`: major branch
- `concept`: independently learnable concept
- `mechanism`: how something works
- `method`: procedure or technique
- `tool`: concrete implementation tool
- `formula`: mathematical or formal detail
- `example`: test, case, or application detail

Granularity:

- `1`: scope and field
- `2`: topic or module
- `3`: core learnable concept
- `4`: mechanism or method
- `5`: formula, implementation, measurement, or example

## Relation direction

- `part_of`: source is a component of target
- `contains`: source contains target
- `prerequisite`: source should be learned before target
- `enables`: source enables or affects target
- `applied_in`: source is applied in target
- `contrasts_with`: source contrasts with target
- `related_to`: evidence supports adjacency but the precise relation is unclear

Use `related_to` sparingly. Prefer a typed relation when the evidence supports one.

## Evidence policy

- The first `--note` input is `note_1`, the second is `note_2`, and `--text` or `--stdin` receives the next number after all file inputs. Drafts must use this exact positional mapping.
- A note-backed excerpt must occur verbatim in the input note.
- A model proposal without a source must use `evidence: []`.
- Do not treat model confidence as source authority.
- Keep uncertain concepts as boundary nodes for review.
- Do not mark a concept understood merely because a note mentions or saves it.
