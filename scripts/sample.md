# Quarterly Platform Review

Revenue reached ==$4.2M in Q3==, up 18% year over year. The gain came almost
entirely from the enterprise tier, where seat expansion outpaced new logos for
the first time since launch.

## Highlights

- Enterprise ARR crossed **$3.1M**, now 74% of total
- Median time-to-first-value fell from 11 days to _4 days_
- Churn held flat at 1.2% monthly despite the price change

:::success What worked
Self-serve onboarding removed the sales call from the first week. Every cohort
since June has activated faster than the one before it.
:::

:::warning Watch this
Support load per account is rising faster than headcount. At the current slope
the queue exceeds capacity in ~7 weeks.
:::

## Numbers

| Segment    |   Q2 |   Q3 | Change |
| ---------- | ---: | ---: | -----: |
| Enterprise | 2.4M | 3.1M |   +29% |
| Team       | 0.9M | 0.8M |   -11% |
| Individual | 0.3M | 0.3M |     0% |

> The enterprise motion is working. The self-serve funnel is not paying for
> itself yet.

## Implementation note

The activation metric is computed nightly:

```sql
SELECT account_id, min(event_at) AS first_value
FROM   product_events
WHERE  event_name = 'workspace_published'
GROUP  BY account_id;
```

<!-- pagebreak -->

## Next quarter

1. Hire two support engineers before the queue breaks
2. Re-price the Team tier or sunset it
3. Ship SSO, the top blocker in 9 of 14 lost deals

:::danger Risk
The Team tier decline is not yet explained. If it is cannibalisation by
Enterprise it is fine; if it is a product problem it will reach Enterprise next.
:::

See the [full dashboard](https://example.com/dashboard) for daily figures.
