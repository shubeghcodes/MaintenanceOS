import { ButtonLink, Card, EmptyState } from "@/components/ui";

export default function NotFound() {
  return (
    <Card>
      <EmptyState title="Not found, or you don’t have access to it.">
        <div className="mt-4">
          <ButtonLink href="/" variant="secondary">
            Back to dashboard
          </ButtonLink>
        </div>
      </EmptyState>
    </Card>
  );
}
