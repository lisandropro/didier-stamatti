import { PageSkeleton, SkeletonCards } from "@/components/Skeletons";

export default function Loading() {
  return (
    <PageSkeleton title="Período">
      <SkeletonCards count={3} lines={3} />
    </PageSkeleton>
  );
}
