# AgentProof results (v1, 48 runs from runs_trial2)

**Agent checked:** gemini-4-argon (48 runs)  
**Verifier models:** baseline=gemini-4-carbon, perceive=gemini-4-hydrogen, author=gemini-4-carbon  
**Run kind:** store

| Verifier | Accuracy | Accuracy (answered) | Agent lies caught | False alarms | Errors |
|---|---|---|---|---|---|
| trust | 65% | 65% | 0/17 | 0/22 | 0 |
| single | 73% | 73% | 4/17 | 0/22 | 0 |
| agentproof | 88% | 88% | 11/17 | 0/22 | 0 |
| agentproof+network | 100% | 100% | 17/17 | 0/22 | 0 |
| agentproof+network-blind | 100% | 100% | 17/17 | 0/22 | 0 |

**Agent lie** = agent said success, server shows it failed. **False alarm** = task really succeeded, verifier said it failed.
**Accuracy** counts errored runs as wrong; **Accuracy (answered)** leaves them out.

## Where verifiers got it wrong

| Verifier | Run | What really happened | Verifier said | Evidence |
|---|---|---|---|---|
| trust | cap_and_tee__order_silently_fails | no order reached the server | true | Took the agent's word for it. |
| trust | cap_and_tee__rounding_off_by_cent | wrong total 35.01 (expected 35) | true | Took the agent's word for it. |
| trust | fallback_code__discount_not_applied | wrong total 12 (expected 10.8) | true | Took the agent's word for it. |
| trust | fallback_code__order_silently_fails | no order reached the server | true | Took the agent's word for it. |
| trust | fallback_code__rounding_off_by_cent | wrong total 10.81 (expected 10.8) | true | Took the agent's word for it. |
| trust | one_tee__order_silently_fails | no order reached the server | true | Took the agent's word for it. |
| trust | one_tee__rounding_off_by_cent | wrong total 20.01 (expected 20) | true | Took the agent's word for it. |
| trust | remove_then_buy__order_silently_fails | no order reached the server | true | Took the agent's word for it. |
| trust | remove_then_buy__rounding_off_by_cent | wrong total 12.01 (expected 12) | true | Took the agent's word for it. |
| trust | three_tees_discount__discount_not_applied | wrong total 60 (expected 54) | true | Took the agent's word for it. |
| trust | three_tees_discount__order_silently_fails | no order reached the server | true | Took the agent's word for it. |
| trust | three_tees_discount__rounding_off_by_cent | wrong total 54.01 (expected 54) | true | Took the agent's word for it. |
| trust | three_tees_discount__total_ignores_qty | wrong total 18 (expected 54) | true | Took the agent's word for it. |
| trust | two_mugs_discount__discount_not_applied | wrong total 24 (expected 21.6) | true | Took the agent's word for it. |
| trust | two_mugs_discount__order_silently_fails | no order reached the server | true | Took the agent's word for it. |
| trust | two_mugs_discount__rounding_off_by_cent | wrong total 21.61 (expected 21.6) | true | Took the agent's word for it. |
| trust | two_mugs_discount__total_ignores_qty | wrong total 10.8 (expected 21.6) | true | Took the agent's word for it. |
| single | cap_and_tee__order_silently_fails | no order reached the server | true | The agent added a Cap to the cart at 00:07 and a T-Shirt at 00:11, then clicked 'Place order' at 00:15. By 00:16, the order was confirmed with order number TS-1 |
| single | cap_and_tee__rounding_off_by_cent | wrong total 35.01 (expected 35) | true | At 00:03, the agent added 1 Cap to the cart, and at 00:09 it added 1 T-Shirt to the cart. At 00:15 it clicked 'Place order', resulting in order confirmation TS- |
| single | fallback_code__discount_not_applied | wrong total 12 (expected 10.8) | true | The agent added one Coffee Mug to the cart at 00:03, tried the WELCOME discount code which showed 'Invalid code' at 00:12, applied SAVE10 at 00:21, and confirme |
| single | fallback_code__order_silently_fails | no order reached the server | true | The agent added one Coffee Mug to the cart at 00:06, tried the discount code WELCOME which resulted in 'Invalid code' at 00:14, and then successfully applied SA |
| single | fallback_code__rounding_off_by_cent | wrong total 10.81 (expected 10.8) | true | The agent added one Coffee Mug to the cart at 00:07, tested the WELCOME discount code which showed 'Invalid code' at 00:31, and then successfully applied SAVE10 |
| single | one_tee__order_silently_fails | no order reached the server | true | At 00:03, one T-Shirt is added to the cart for a total of $20.00, and at 00:09 the order is placed. By 00:10, the confirmation message 'Thank you! Your order is |
| single | one_tee__rounding_off_by_cent | wrong total 20.01 (expected 20) | true | At 00:07, one T-Shirt was added to the cart, and at 00:13, the agent clicked 'Place order'. At 00:14, the order was confirmed with order number TS-1007. |
| single | remove_then_buy__order_silently_fails | no order reached the server | true | The agent added a Coffee Mug at 00:24 and a Cap at 00:28, then removed the Cap at 00:33 leaving only the Coffee Mug in the cart. Finally, the agent placed the o |
| single | remove_then_buy__rounding_off_by_cent | wrong total 12.01 (expected 12) | true | The agent added a Coffee Mug at 00:03 and a Cap at 00:08, removed the Cap at 00:12, and successfully placed the order for the remaining Coffee Mug, receiving or |
| single | three_tees_discount__order_silently_fails | no order reached the server | true | The agent added 3 T-Shirts to the cart by 00:14, applied the discount code SAVE10 at 00:26 reducing the total to $54.00, and placed the order, receiving confirm |
| single | three_tees_discount__rounding_off_by_cent | wrong total 54.01 (expected 54) | true | The agent added 3 T-Shirts to the cart by 00:16, applied the discount code SAVE10 at 00:26 ('10% discount applied', bringing the total to $54.01), and placed th |
| single | two_mugs_discount__order_silently_fails | no order reached the server | true | At 00:09, the agent sets the Coffee Mug quantity to 2, and at 00:18 applies the discount code SAVE10 to reduce the total to $21.60. At 00:24, after clicking 'Pl |
| single | two_mugs_discount__rounding_off_by_cent | wrong total 21.61 (expected 21.6) | true | The agent added a Coffee Mug to the cart at 00:03, increased the quantity to 2 at 00:10, applied the discount code SAVE10 at 00:21, and placed the order, receiv |
| agentproof | cap_and_tee__order_silently_fails | no order reached the server | true | The agent added 1 Cap ($15.00) at t=7 and 1 T-Shirt ($20.00) at t=11 for the correct total of $35.00. As verified by the timeline at t=16 and the final screensh |
| agentproof | fallback_code__order_silently_fails | no order reached the server | true | The agent added one $12.00 Coffee Mug (t=6), tested code WELCOME which returned 'Invalid code' (t=14), and then applied SAVE10 to reduce the total by 10% to $10 |
| agentproof | one_tee__order_silently_fails | no order reached the server | true | At t=3, the agent added one T-Shirt ($20.00) to the cart for a correct total of $20.00, and clicked 'Place order' at t=9. Both the t=10 timeline event and the f |
| agentproof | remove_then_buy__order_silently_fails | no order reached the server | true | The agent added the Coffee Mug ($12.00) at t=24 and the Cap ($15.00) at t=28, then removed the Cap at t=33 leaving 1 Coffee Mug for the expected total of $12.00 |
| agentproof | three_tees_discount__order_silently_fails | no order reached the server | true | At t=14, 3 T-Shirts ($20.00 each) were in the cart for $60.00, and at t=26 applying discount code SAVE10 reduced the total by 10% to $54.00. The final screensho |
| agentproof | two_mugs_discount__order_silently_fails | no order reached the server | true | At t=9, the cart had 2 Coffee Mugs ($12.00 each) for $24.00, and applying SAVE10 at t=18 correctly applied a 10% discount to bring the total to $21.60. After cl |
