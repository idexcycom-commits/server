await fetch("https://d1-server.idexcy-com.workers.dev/api/orders", {
    method: "POST",
    headers: {
        "Content-Type": "application/json"
    },
    body: JSON.stringify({

        userId,

        razorpay: response,

        customer: {
            name,
            email,
            phone
        },

        shipping: {
            address,
            city,
            state,
            pincode
        },

        items: cartItems

    })
});\



https://d1-server.idexcy-com.workers.dev/api/admin/products

{
  "name": "90% Dark Chocolate",
  "description": "Single-origin dark chocolate sweetened with monk fruit.",
  "price": 359,
  "stock": 100,
  "image": "https://idexcy.com/images/90-dark.jpg",
  "category": "Dark Chocolate"
}

https://d1-server.idexcy-com.workers.dev/api/users/1
{
  "name": "John Doe",
  "email": "john@example.com",
  "is_admin": 1
}