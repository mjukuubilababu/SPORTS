import type{CircuitBreakerState}from"../domain/types.js";

export function nextCircuitState(
  current:CircuitBreakerState,
  success:boolean,
  now:string,
  openFailureRate=.5,
  openConsecutiveFailures=5
):CircuitBreakerState{
  const failures=success?0:current.consecutive_failures+1;
  let state=current.state,opened=current.opened_at;
  const rate=success?Math.max(0,current.failure_rate*.8):Math.min(1,current.failure_rate*.8+.2);

  if(current.state==="CLOSED"&&(rate>=openFailureRate||failures>=openConsecutiveFailures)){
    state="OPEN";opened=now;
  }else if(current.state==="HALF_OPEN"){
    if(success){state="CLOSED";opened=null}else{state="OPEN";opened=now}
  }
  return {...current,state,failure_rate:rate,consecutive_failures:failures,opened_at:opened,last_transition_at:state!==current.state?now:current.last_transition_at};
}
