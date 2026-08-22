export function probabilityInvariant(values:number[]):boolean{return values.every(x=>Number.isFinite(x)&&x>=0&&x<=1)}
export function temporalInvariant(observedAt:string,occurredAt:string):boolean{return Date.parse(observedAt)<=Date.parse(occurredAt)}
export function monotonicLineageInvariant(parentCount:number,childCount:number):boolean{return childCount>=parentCount}
export function noDuplicateBusinessEffect(keys:string[]):boolean{return new Set(keys).size===keys.length}
