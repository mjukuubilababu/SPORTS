import type{StorageTierPolicy}from"../domain/types.js";
export function storageTier(ageDays:number,p:StorageTierPolicy):"HOT"|"WARM"|"COLD"|"ARCHIVE"{
 if(p.archive_after_days!==null&&ageDays>=p.archive_after_days)return"ARCHIVE";
 if(ageDays>=p.cold_after_days)return"COLD";
 if(ageDays>=p.hot_days)return"WARM";
 return"HOT";
}
