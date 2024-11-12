import { ChromaClient, OpenAIEmbeddingFunction } from 'chromadb'
import chromadb from '../config/chromadb'
import { askStream } from '../lib/openai'
import { DiscordJob, DiscordWorker } from '../lib/DiscordWorker'
import equalityGoals from '../prompts/followUp/equalityGoals'
import { zodResponseFormat } from "openai/helpers/zod";

const embedder = new OpenAIEmbeddingFunction({
  openai_api_key: process.env.OPENAI_API_KEY,
})

class JobData extends DiscordJob {
  declare data: DiscordJob['data'] & {
    documentId: string
    apiSubEndpoint: string
    prompt: string
    schema: string
    json: string
    previousAnswer: string
  }
}

const followUp = new DiscordWorker<JobData>(
  'followUp',
  async (job: JobData) => {
    const {
      prompt,
      schema,
      url,
      json,
      previousAnswer,
      apiSubEndpoint,
      wikidataId,
    } = job.data

    // TODO: Move these to an helper function, e.g. getParagraphs()
    const client = new ChromaClient(chromadb)
    const collection = await client.getCollection({
      name: 'emission_reports',
      embeddingFunction: embedder,
    })
    /* might get better results if we query for imaginary results from a query instead of the actual query
    const query = await ask([
      {
        role: 'user',
        content:
          'Please give me some example data from this prompt that I can use as search query in a vector database indexed from PDFs. OK?'
      },
      {role: 'assistant', content: 'OK sure, give '},
          prompt,
      },
    ])*/

    const results = await collection.query({
      nResults: 5,
      where: {
        source: url,
      },
      queryTexts: [prompt],
    })
    const pdfParagraphs = results.documents.flat()

    job.log(`Reflecting on: ${prompt}
    ${json}
    
    Context:
    ${pdfParagraphs.join('\n\n----------------\n\n')}
    
    `)

    // Equality Goals Extraction Section
    const equalityResults = await collection.query({
      nResults: 5,
      where: {
        source: url,
      },
      queryTexts: [equalityGoals.prompt],
    })

    const equalityParagraphs = equalityResults.documents.flat()

    job.log(`Equality goals extraction for ${url}:
    ${equalityParagraphs.join('\n\n----------------\n\n')}
    `)

    try {
      const equalityResponse = await askStream(
        [
          {
            role: 'system',
            content:
              'You are an expert in corporate equality goals and diversity initiatives. Extract data relevant to these topics from the provided PDF context.',
          },
          {
            role: 'user',
            content:
              'Equality goals extracted from PDF:\n' +
              equalityParagraphs.join('\n\n------------------------------\n\n'),
          },
        ],
        {
          response_format: zodResponseFormat(equalityGoals.schema, 'equalityGoals'),
        }
      )

      console.log("Equality Goals Response: ", equalityResponse)
      job.log('Equality Goals Response: ' + equalityResponse)
    }catch (err){
      console.log("err", err)
    }



    const response = await askStream(
      [
        {
          role: 'system',
          content:
            'You are an expert in CSRD and will provide accurate data from a PDF with company CSRD reporting. Be concise and accurate.',
        },
        {
          role: 'user',
          content:
            'Results from PDF: \n' +
            pdfParagraphs.join('\n\n------------------------------\n\n'),
        },
        {
          role: 'user',
          content: `This is the result of a previous prompt:


\`\`\`json
${json}
\`\`\`

## Please add diffs to the prompt based on the instructions:
${prompt}

## Output:
For example, if you want to add a new field called "industry" the response should look like this (only reply with valid json):
{
  "industry": {...}
}
`,
        },
        Array.isArray(job.stacktrace)
          ? [
            { role: 'assistant', content: previousAnswer },
            { role: 'user', content: job.stacktrace.join('') },
          ]
          : undefined,
      ]
        .flat()
        .filter((m) => m?.content) as any[],
      {
        response_format: schema,
      }
    )

    job.log('Response: ' + response)
    return {response, equalityResults}
  }
)

export default followUp
