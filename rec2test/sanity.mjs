// No API key needed. Proves the mutation harness tells strong tests from weak ones.
import { scoreSpec, MUTANTS } from "./score.mjs";
import { rootPath } from "../src/paths.mjs";

for (const name of ["strong", "weak"]) {
  const s = await scoreSpec(rootPath("rec2test", "reference", `${name}.spec.ts`));
  console.log(`${name.padEnd(7)} valid=${s.valid}  killed ${s.killed.length}/${MUTANTS.length}`);
  if (s.survived?.length) console.log(`        survived: ${s.survived.join(", ")}`);
  if (!s.valid) console.log(s.cleanLog);
}
