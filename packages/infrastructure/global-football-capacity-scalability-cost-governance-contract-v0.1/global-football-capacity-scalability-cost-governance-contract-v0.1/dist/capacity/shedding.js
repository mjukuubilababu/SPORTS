export function shouldShed(priority, workload, systemSaturated, protectedWorkloads) {
    if (!systemSaturated)
        return false;
    if (protectedWorkloads.includes(workload))
        return false;
    return priority === "LOW" || priority === "NORMAL";
}
