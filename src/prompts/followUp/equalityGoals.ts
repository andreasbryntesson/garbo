import { z } from 'zod'

export const schema = z.object({
  equalityGoals: z.array(
    z.object({
      description: z.string(),
      year: z.string().optional(),
      targetPercentage: z.number().optional(),
      baseYear: z.string().optional(),
    })
  ),
})

export const prompt = `
Extract the company's equality, diversity, and inclusion goals, including gender equality, diversity initiatives, and social responsibility goals. Add this information as a field named equalityGoals. Focus on targets related to gender balance, diversity quotas, and any programs promoting inclusion.

Prioritize the list and only include the most important goals. If the list is long, only include up to ten primary goals that relate directly to equality and diversity initiatives.

If a year is mentioned as a target date, include it. If no target is specified, set the year to null.

** LANGUAGE: WRITE IN SWEDISH. If text is in english, translate to Swedish **

Example - Output should be in JSON format and follow the structure below without markdown:
{
  "equalityGoals": [
    {
      "description": "Öka andelen kvinnliga chefer till 40%",
      "year": "2025",
      "targetPercentage": 40,
      "baseYear": "2023"
    },
    {
      "description": "Etablera mångfaldsprogram inom tekniska avdelningar",
      "year": "2026",
      "targetPercentage": null,
      "baseYear": null
    }
  ]
}
`

export default { prompt, schema }
