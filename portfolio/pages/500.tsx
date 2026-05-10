// Custom 500 page — required to keep `next build --output export` from
// auto-generating one that conflicts with our _document.tsx.
import Link from 'next/link';

export default function ServerError() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="text-center">
        <h1 className="text-5xl font-bold mb-3 text-gray-900">500</h1>
        <p className="text-lg text-gray-600 mb-5">Something went wrong on our end.</p>
        <Link href="/" className="text-blue-600 hover:text-blue-800 underline">
          Return home
        </Link>
      </div>
    </div>
  );
}
