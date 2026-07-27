import { PageSkeleton, SkeletonCards } from "@/components/Skeletons";

export default function Loading() {
  return (
    <PageSkeleton title="Mi cuenta">
      <SkeletonCards count={3} lines={4} />
    </PageSkeleton>
  );
}
