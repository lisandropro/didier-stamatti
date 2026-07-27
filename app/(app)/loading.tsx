import { PageSkeleton, SkeletonCards } from "@/components/Skeletons";

export default function Loading() {
  return (
    <PageSkeleton title="Fin de semana">
      <SkeletonCards count={3} lines={3} />
    </PageSkeleton>
  );
}
