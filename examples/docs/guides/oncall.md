---
title: On-call Runbook
tags: [ops, oncall]
---
# On-call Runbook

## Paging

Pages arrive through PagerDuty. Acknowledge within 5 minutes.

## Database incidents

Check replication lag first. If the primary is down, promote the replica
and open an incident channel.
