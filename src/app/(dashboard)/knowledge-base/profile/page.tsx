import { KnowledgeBaseNav } from "@/components/knowledge-base/KnowledgeBaseNav";
import { ProfileEditor } from "@/components/knowledge-base/ProfileEditor";

/**
 * Organization profile editor (BLUEPRINT §4.7). The profile is the primary
 * source the AI draft generator draws from — nothing is fabricated beyond what
 * is entered here. Board members and programs are managed inline as sub-tables.
 */
export default function KnowledgeBaseProfilePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
          Organization Profile
        </h1>
        <p className="mt-1 text-sm text-navy-500">
          The verified facts about your organization that power grant drafting.
        </p>
      </div>

      <KnowledgeBaseNav />

      <ProfileEditor />
    </div>
  );
}
