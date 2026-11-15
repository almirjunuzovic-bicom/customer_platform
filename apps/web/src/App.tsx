import { RouterProvider } from "@tanstack/react-router";
import { Login } from "@/components/Login";
import { router } from "@/router";
import { useAuth } from "@/lib/auth-context";

function App() {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <Login />;
  }

  return <RouterProvider router={router} />;
}

export default App;
