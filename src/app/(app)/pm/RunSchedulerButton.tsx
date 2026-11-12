import { SubmitButton } from "@/components/SubmitButton";
import { runScheduler } from "./actions";

export function RunSchedulerButton({ back }: { back: string }) {
  return (
    <form action={runScheduler}>
      <input type="hidden" name="back" value={back} />
      <SubmitButton variant="secondary" pendingText="Running…">
        Run scheduler now
      </SubmitButton>
    </form>
  );
}
