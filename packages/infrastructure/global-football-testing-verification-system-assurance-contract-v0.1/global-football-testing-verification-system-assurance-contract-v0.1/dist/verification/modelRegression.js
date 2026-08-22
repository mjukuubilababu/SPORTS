export function modelRegressionDecision(x) {
    let decision = "PASS";
    if (x.critical_slice_regression || x.brier_delta > .02 || x.logloss_delta > .02 || x.max_drawdown_delta > .10)
        decision = "FAIL";
    else if (x.brier_delta > .005 || x.logloss_delta > .005 || x.ece_delta > .01 || x.coverage_delta < -.05)
        decision = "REVIEW";
    return { ...x, decision };
}
