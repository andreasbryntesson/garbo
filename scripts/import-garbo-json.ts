import { Prisma, PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

import companies from '../companies.json'
import { addIndustryGicsCodesToDB } from './add-gics'
import { promisify } from 'util'
import { exec } from 'child_process'

async function prepareEmissionUnits() {
  return {
    tCO2e: await prisma.emissionUnit.create({ data: { name: 'tCO2e' } }),
  }
}

async function prepareCurrencies(allCompanies: typeof companies) {
  const uniqueCurrencies = new Set<string>()

  for (const company of allCompanies) {
    for (const [year, baseFacts] of Object.entries(company.baseFacts ?? {})) {
      if (baseFacts?.unit) {
        const currency = baseFacts.unit.toUpperCase()
        uniqueCurrencies.add(currency)
      }
    }
  }

  return prisma.currency.createManyAndReturn({
    data: [...uniqueCurrencies].map((name) => ({ name })),
  })
}

function getFirstDefinedValue(...values: (string | null | undefined)[]) {
  for (const value of values) {
    if (value && value.length) {
      return value
    }
  }
}

function getName(company: (typeof companies)[number]) {
  let name = getFirstDefinedValue(
    company.facit?.companyName,
    company.wikidata?.label,
    company.companyName
  )
  if (!name) {
    throw new Error('name missing for ' + JSON.stringify(company, null, 2))
  }

  return name
}

function getWikidataId(company: (typeof companies)[number]) {
  let wikidataId = getFirstDefinedValue(
    company.wikidata?.node,
    company.wikidataId
  )
  if (!wikidataId) {
    throw new Error('wikidataId missing for ' + getName(company))
  }

  return wikidataId
}

async function getGicsCode(company: (typeof companies)[number]) {
  const code = company.industryGics?.subIndustry?.code
  if (!code) return
  return (
    await prisma.industryGics.findUnique({
      where: {
        subIndustryCode: code,
      },
      select: {
        subIndustryCode: true,
      },
    })
  )?.subIndustryCode
}

async function main() {
  // INIT
  console.log('Resetting database and applying migrations...')
  await promisify(exec)('npx prisma migrate reset --force')

  const currencies = await prepareCurrencies(companies)
  await addIndustryGicsCodesToDB()
  const [user, alex] = await prisma.user.createManyAndReturn({
    data: [
      {
        email: 'hej@klimatkollen.se',
        name: 'Klimatkollen',
      },
      {
        email: 'alex@klimatkollen.se',
        name: 'Alexandra Palmquist',
      },
    ],
  })

  // TODO: properly create sources for all unique report URLs
  const source = await prisma.source.create({
    data: {
      comment: 'Garbo import',
      url: 'https://klimatkollen.se',
    },
  })

  // TODO: properly create metadata for every datapoint
  const metadata = await prisma.metadata.create({
    data: {
      comment: 'Initial import',
      updatedAt: new Date(),
      updaterId: user.id,
      sources: {
        connect: [{ id: source.id }],
      },
      dataOrigin: {
        create: {
          name: 'Garbo extraction',
        },
      },
    },
  })

  async function createEconomy(economy) {
    // if the currency exists, use it, otherwise create it

    const currencyId = economy.currency
      ? currencies.find((c) => c.name === economy.currency.toUpperCase())?.id
      : null

    const { id } = await prisma.economy.create({
      data: {
        turnover: {
          create: {
            value: economy.turnover,
            currencyId,
            metadataId: metadata.id,
          },
        },
        employees: {
          create: {
            value: economy.employees,
            // TODO: Add employees unit when importing the facit data
            metadataId: metadata.id,
          },
        },
        metadataId: metadata.id,
      },
      select: {
        id: true,
      },
    })

    return id
  }

  const EMISSION_UNITS = await prepareEmissionUnits()

  const tCO2e = EMISSION_UNITS.tCO2e

  async function createEmissionsForYear(
    year: string,
    company: (typeof companies)[number]
  ) {
    const emissions = company.emissions?.[year]
    if (!emissions) return null

    function createScope3Category(category: number, key: string) {
      return {
        category,
        total: emissions.scope3?.categories?.[key],
        unitId: tCO2e.id,
        metadataId: metadata.id,
      }
    }

    const biogenicEmissions:
      | Prisma.BiogenicEmissionsCreateNestedOneWithoutEmissionsInput
      | undefined = Number.isFinite(emissions.totalBiogenic)
      ? {
          create: {
            total: emissions.totalBiogenic,
            unitId: tCO2e.id,
            metadataId: 1,
          },
        }
      : undefined

    const statedTotalScope3Emissions:
      | Prisma.StatedTotalEmissionsUncheckedCreateNestedOneWithoutScope3Input
      | undefined = Number.isFinite(emissions.scope3?.emissions)
      ? {
          create: {
            total: Number(emissions.scope3?.emissions ?? 0),
            unitId: tCO2e.id,
            metadataId: 1,
          },
        }
      : undefined

    const { id } = await prisma.emissions.create({
      data: {
        biogenicEmissions,
        scope1: {
          create: {
            total: emissions.scope1?.emissions || null,
            unitId: tCO2e.id,
            metadataId: 1,
          },
        },
        scope2: {
          create: {
            mb: emissions.scope2?.mb || null,
            lb: emissions.scope2?.lb || null,
            unknown: emissions.scope2?.emissions || null,
            unitId: tCO2e.id,
            metadataId: 1,
          },
        },

        // TODO: handle import for scope1And2
        // TODO: Add scope1And2 to the API response and calculations if it exists. Ignore if scope 1 and scope 2 have been added separately.
        scope3: {
          create: {
            statedTotalEmissions: statedTotalScope3Emissions,
            scope3Categories: {
              createMany: {
                data: [
                  '1_purchasedGoods',
                  '2_capitalGoods',
                  '3_fuelAndEnergyRelatedActivities',
                  '4_upstreamTransportationAndDistribution',
                  '5_wasteGeneratedInOperations',
                  '6_businessTravel',
                  '7_employeeCommuting',
                  '8_upstreamLeasedAssets',
                  '9_downstreamTransportationAndDistribution',
                  '10_processingOfSoldProducts',
                  '11_useOfSoldProducts',
                  '12_endOfLifeTreatmentOfSoldProducts',
                  '13_downstreamLeasedAssets',
                  '14_franchises',
                  '15_investments',
                  '16_other',
                ].map((key) =>
                  createScope3Category(parseInt(key.split('_')?.[0]), key)
                ),
              },
            },
            metadataId: 1,
          },
        },
      },
      select: {
        id: true,
      },
    })

    return id
  }

  // IMPORT
  for (const company of companies) {
    const gicsCode = await getGicsCode(company)
    console.log(gicsCode, getName(company))

    const years = [
      ...new Set([
        ...Object.keys(company.baseFacts ?? {}),
        ...Object.keys(company.emissions ?? {}),
      ]),
    ]

    const added = await prisma.company.create({
      data: {
        name: getName(company),
        description: company.description,
        wikidataId: getWikidataId(company),
        industry: gicsCode
          ? {
              create: {
                gicsSubIndustryCode: gicsCode,
                metadataId: metadata.id,
              },
            }
          : undefined,
        initiatives: Array.isArray(company.initiatives)
          ? {
              createMany: {
                data: company.initiatives.map(
                  (initiative: (typeof company.initiatives)[number]) => ({
                    title: initiative.title,
                    description: initiative.description,
                    year: initiative.year,
                    scope: Array.isArray(initiative.scope)
                      ? initiative.scope.join(',')
                      : initiative.scope,
                    metadataId: metadata.id,
                  })
                ),
              },
            }
          : undefined,
        goals: Array.isArray(company.goals)
          ? {
              createMany: {
                data: company.goals.map(
                  (goal: (typeof company.goals)[number]) => ({
                    description: goal.description,
                    year: goal.year?.toString() || null,
                    target: goal.target,
                    baseYear: goal.baseYear,
                    metadataId: metadata.id,
                  })
                ),
              },
            }
          : undefined,

        reportingPeriods:
          company.baseFacts || company.emissions
            ? {
                createMany: {
                  data: await Promise.all(
                    years.map(async (year) => {
                      const {
                        turnover,
                        employees,
                        unit: currency,
                      } = company.baseFacts?.[year] ?? {
                        turnover: null,
                        employees: null,
                        unit: null,
                      }
                      return {
                        startDate: new Date(`${year}-01-01`),
                        endDate: new Date(`${year}-12-31`),
                        economyId: await createEconomy({
                          turnover: turnover ? parseFloat(turnover) : null,
                          employees,
                          currency: currency || null,
                        }),
                        emissionsId: await createEmissionsForYear(
                          year,
                          company
                        ),
                        metadataId: metadata.id,
                      }
                    })
                  ),
                },
              }
            : undefined,
      },
    })
  }
}

await main()