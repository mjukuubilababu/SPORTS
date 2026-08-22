import { ContractError } from './errors.mjs';
import { DATA_CONTRACT_VERSION } from './constants.mjs';
import { deepFreeze, id, nowIso } from './utils.mjs';
export function normalizeProviderEvent(raw,{clock}={}){
  const required=['providerEventId','provider','competitionId','seasonId','kickoffAt','homeTeam','awayTeam','observedAt','market'];
  for(const k of required) if(raw[k]===undefined||raw[k]===null) throw new ContractError(`MISSING_FIELD:${k}`);
  const observed=new Date(raw.observedAt), kickoff=new Date(raw.kickoffAt);
  if(Number.isNaN(+observed)||Number.isNaN(+kickoff)) throw new ContractError('INVALID_TIMESTAMP');
  if(observed>=kickoff) throw new ContractError('FUTURE_OR_LATE_EVIDENCE');
  for(const k of ['o25','o35','u35']) if(!(Number(raw.market[k])>1)) throw new ContractError(`INVALID_ODDS:${k}`);
  const eventId=id('evt',[raw.competitionId,raw.seasonId,raw.kickoffAt,raw.homeTeam,raw.awayTeam]);
  return deepFreeze({
    id:eventId,contractVersion:DATA_CONTRACT_VERSION,providerEventId:String(raw.providerEventId),provider:String(raw.provider),
    competitionId:String(raw.competitionId),seasonId:String(raw.seasonId),kickoffAt:kickoff.toISOString(),
    homeTeam:String(raw.homeTeam),awayTeam:String(raw.awayTeam),observedAt:observed.toISOString(),
    market:{o25:Number(raw.market.o25),o35:Number(raw.market.o35),u35:Number(raw.market.u35),quoteType:String(raw.market.quoteType||'SNAPSHOT')},
    source:{uri:String(raw.source?.uri||'fixture://controlled'),captureMethod:String(raw.source?.captureMethod||'FIXTURE'),verified:Boolean(raw.source?.verified)},
    normalizedAt:nowIso(clock)
  });
}
